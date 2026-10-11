import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { generateText, Output } from "ai";
import { getChatModel } from "@/lib/ai/model";
import { notesSchema } from "@/lib/schemas/notes";
import { accessToken, createBackgroundClient } from "@/lib/supabase/server";
import {
  getMeeting,
  getNotes,
  getNotesProgress,
  listSegments,
  listSpeakers,
  saveNotes,
  updateMeeting,
} from "@/lib/storage/meetings";
import { formatTimestamp } from "@/lib/format";
import { isCreditError } from "@/lib/speech/client";
import type { NotesContent, Segment } from "@/lib/types";

const WINDOW_CHARS = 12_000;
const WINDOWS_PER_RUN = 2;
const LOCK_MS = 45_000;

type NotesProgress = {
  nextIndex: number;
  windowCount: number;
  windows: NotesContent[];
  coveredThroughMs: number;
  startedAt: string | null;
  mergePending: boolean;
};

function notesProgress(value: unknown): NotesProgress {
  const progress =
    value && typeof value === "object" ? (value as Partial<NotesProgress>) : {};
  return {
    nextIndex: typeof progress.nextIndex === "number" ? progress.nextIndex : 0,
    windowCount: typeof progress.windowCount === "number" ? progress.windowCount : 0,
    windows: Array.isArray(progress.windows) ? progress.windows : [],
    coveredThroughMs: typeof progress.coveredThroughMs === "number" ? progress.coveredThroughMs : 0,
    startedAt: typeof progress.startedAt === "string" ? progress.startedAt : null,
    mergePending: progress.mergePending === true,
  };
}

function locked(progress: NotesProgress) {
  if (!progress.startedAt) return false;
  return Date.now() - Date.parse(progress.startedAt) < LOCK_MS;
}

function combine(parts: NotesContent[]): NotesContent {
  return {
    overview: parts.map((part) => part.overview.trim()).filter(Boolean).join("\n\n"),
    key_points: parts.flatMap((part) => part.key_points),
    decisions: parts.flatMap((part) => part.decisions),
    open_questions: parts.flatMap((part) => part.open_questions),
    action_items: parts.flatMap((part) => part.action_items),
  };
}

export async function queueNotes(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  options?: { restart?: boolean },
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) return;
  const current = notesProgress(await getNotesProgress(supabase, meetingId));
  const resume =
    !options?.restart &&
    current.windowCount > 0 &&
    (current.nextIndex < current.windowCount || current.mergePending);
  if (meeting.notesStatus === "generating" && !options?.restart) return;
  const token = await accessToken(supabase);
  if (!token) throw new Error("Sign in to continue.");
  const background = createBackgroundClient(token);
  await updateMeeting(supabase, userId, meetingId, {
    notesStatus: "generating",
    notesError: null,
    notesProgress: {
      ...(resume
        ? current
        : { nextIndex: 0, windowCount: 0, windows: [], coveredThroughMs: 0, mergePending: false }),
      startedAt: new Date().toISOString(),
    },
  });
  after(() => generateMeetingNotes(background, userId, meetingId));
}

export async function continueNotes(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting || meeting.notesStatus !== "generating") return;
  const current = notesProgress(await getNotesProgress(supabase, meetingId));
  if (locked(current)) return;
  const token = await accessToken(supabase);
  if (!token) return;
  const background = createBackgroundClient(token);
  await updateMeeting(supabase, userId, meetingId, {
    notesProgress: { ...current, startedAt: new Date().toISOString() },
  });
  after(() => generateMeetingNotes(background, userId, meetingId));
}

function keepIds(ids: string[], known: Set<string>) {
  return ids.filter((id) => known.has(id));
}

function grounded(content: NotesContent, known: Set<string>, speakerIds: Set<string>, transcript: string) {
  const item = (entry: { text: string; evidence_segment_ids: string[] }) => ({
    text: entry.text.trim(),
    evidence_segment_ids: keepIds(entry.evidence_segment_ids, known),
  });
  const lower = transcript.toLowerCase();
  return {
    overview: content.overview.trim(),
    key_points: content.key_points.map(item).filter((entry) => entry.text),
    decisions: content.decisions.map(item).filter((entry) => entry.text),
    open_questions: content.open_questions.map(item).filter((entry) => entry.text),
    action_items: content.action_items
      .map((entry) => {
        const deadline = entry.deadline?.trim() || null;
        return {
          task: entry.task.trim(),
          owner_speaker_id:
            entry.owner_speaker_id && speakerIds.has(entry.owner_speaker_id)
              ? entry.owner_speaker_id
              : null,
          deadline:
            deadline && lower.includes(deadline.toLowerCase()) ? deadline : null,
          evidence_segment_ids: keepIds(entry.evidence_segment_ids, known),
        };
      })
      .filter((entry) => entry.task),
  } satisfies NotesContent;
}

function windowsOf(segments: Segment[], speakerName: Map<string, string>) {
  const windows: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const segment of segments) {
    const who = segment.speakerId ? (speakerName.get(segment.speakerId) ?? "Unknown") : "Unknown";
    const line = `[${segment.id}] ${formatTimestamp(segment.startMs)} ${who}: ${segment.text}`;
    if (current.length > 0 && size + line.length > WINDOW_CHARS) {
      windows.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += line.length + 1;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

function transcriptOf(segments: Segment[], speakerName: Map<string, string>) {
  return segments
    .map((segment) => {
      const who = segment.speakerId ? (speakerName.get(segment.speakerId) ?? "Unknown") : "Unknown";
      return `[${segment.id}] ${formatTimestamp(segment.startMs)} ${who}: ${segment.text}`;
    })
    .join("\n");
}

async function writeNotes(prompt: string) {
  const result = await generateText({
    model: getChatModel(),
    temperature: 0.2,
    output: Output.object({
      schema: notesSchema,
      name: "MeetingNotes",
      description: "Structured notes grounded in one meeting transcript",
    }),
    prompt,
  });
  return notesSchema.parse(result.output);
}

function notesStop(throughMs: number, message: string) {
  const through = formatTimestamp(throughMs);
  if (isCreditError(message)) {
    return `Notes cover the meeting through ${through}. The model stopped because credits ran out.`;
  }
  return `Notes cover the meeting through ${through}. Write notes again to continue.`;
}

export async function generateMeetingNotes(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) return null;
  const segments = await listSegments(supabase, meetingId);
  const speakers = await listSpeakers(supabase, meetingId);
  if (segments.length === 0) {
    await updateMeeting(supabase, userId, meetingId, {
      notesStatus: "failed",
      notesError: "There is no transcript to write notes from yet.",
      notesProgress: null,
    });
    return null;
  }
  const speakerName = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]));
  const windows = windowsOf(segments, speakerName);
  const progress = notesProgress(await getNotesProgress(supabase, meetingId));
  progress.windowCount = windows.length;
  const known = new Set(segments.map((segment) => segment.id));
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const speakerList = speakers.map((speaker) => `${speaker.id} = ${speaker.displayName}`).join("\n");
  const finish = async (content: NotesContent, notesError: string | null, next: NotesProgress | null) =>
    saveNotes(supabase, userId, meetingId, content, {
      notesStatus: "ready",
      notesError,
      notesProgress: next,
    });

  try {
    if (!progress.mergePending) {
      const end = Math.min(windows.length, progress.nextIndex + WINDOWS_PER_RUN);
      for (let index = progress.nextIndex; index < end; index += 1) {
        const window = windows[index] ?? [];
        const parsed = await writeNotes(`Write structured notes from this part of a meeting transcript.
Use only facts that appear in the transcript. If something was not said, leave that list empty or use null.
Every evidence_segment_ids value must be an id copied from the bracketed segment ids.
owner_speaker_id must be one of the speaker ids below, or null when the transcript does not name an owner.
deadline must be null unless the transcript states that deadline in those words.
The transcript may be English, Hindi, or a mix. Write the notes in the language the meeting was mostly conducted in.

Speakers:
${speakerList || "No speakers identified."}

Transcript:
${transcriptOf(window, speakerName)}`);
        const content = grounded(
          parsed,
          known,
          speakerIds,
          window.map((segment) => segment.text).join("\n"),
        );
        progress.windows.push(content);
        progress.nextIndex = index + 1;
        progress.coveredThroughMs = window.at(-1)?.endMs ?? progress.coveredThroughMs;
        await saveNotes(supabase, userId, meetingId, combine(progress.windows), {
          notesStatus: "generating",
          notesError: null,
          notesProgress: { ...progress, startedAt: new Date().toISOString() },
        });
      }
    }
    if (progress.nextIndex < windows.length) {
      await updateMeeting(supabase, userId, meetingId, {
        notesStatus: "generating",
        notesProgress: { ...progress, startedAt: null },
      });
      return getNotes(supabase, meetingId);
    }
    if (windows.length === 1) {
      return finish(progress.windows[0] ?? combine([]), null, null);
    }
    const parsed = await writeNotes(`Combine these partial meeting notes into one set of notes.
Keep evidence_segment_ids values that already appear below. Do not invent ids or facts.
Drop duplicate points. Write one overview for the whole meeting.
The notes may be English, Hindi, or a mix. Keep the language they already use.

Speakers:
${speakerList || "No speakers identified."}

Partial notes:
${JSON.stringify(progress.windows)}`);
    const merged = grounded(
      parsed,
      known,
      speakerIds,
      segments.map((segment) => segment.text).join("\n"),
    );
    return finish(merged, null, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model did not return valid notes. Try again.";
    if (progress.windows.length === 0) {
      await updateMeeting(supabase, userId, meetingId, {
        notesStatus: "failed",
        notesError: message,
        notesProgress: { ...progress, startedAt: null },
      });
      return null;
    }
    const covered = progress.coveredThroughMs;
    return finish(combine(progress.windows), notesStop(covered, message), {
      ...progress,
      mergePending: progress.nextIndex >= windows.length,
      startedAt: null,
    });
  }
}
