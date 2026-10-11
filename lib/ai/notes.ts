import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { generateText, Output } from "ai";
import { getChatModel } from "@/lib/ai/model";
import { notesSchema } from "@/lib/schemas/notes";
import { accessToken, createBackgroundClient } from "@/lib/supabase/server";
import {
  getMeeting,
  getNotes,
  listSegments,
  listSpeakers,
  saveNotes,
  updateMeeting,
} from "@/lib/storage/meetings";
import { formatTimestamp } from "@/lib/format";
import type { NotesContent } from "@/lib/types";

const inflight = new Set<string>();

export async function queueNotes(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  if (inflight.has(meetingId)) return;
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting || meeting.notesStatus === "generating") return;
  const token = await accessToken(supabase);
  if (!token) throw new Error("Sign in to continue.");
  const background = createBackgroundClient(token);
  inflight.add(meetingId);
  await updateMeeting(supabase, userId, meetingId, {
    notesStatus: "generating",
    notesError: null,
  });
  after(async () => {
    try {
      await generateMeetingNotes(background, userId, meetingId);
    } finally {
      inflight.delete(meetingId);
    }
  });
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
    });
    return null;
  }
  const speakerName = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]));
  const lines = segments.map((segment) => {
    const who = segment.speakerId
      ? (speakerName.get(segment.speakerId) ?? "Unknown")
      : "Unknown";
    return `[${segment.id}] ${formatTimestamp(segment.startMs)} ${who}: ${segment.text}`;
  });
  const transcript = lines.join("\n").slice(0, 14000);
  const speakerList = speakers
    .map((speaker) => `${speaker.id} = ${speaker.displayName}`)
    .join("\n");
  try {
    const result = await generateText({
      model: getChatModel(),
      temperature: 0.2,
      output: Output.object({
        schema: notesSchema,
        name: "MeetingNotes",
        description: "Structured notes grounded in one meeting transcript",
      }),
      prompt: `Write structured notes from this meeting transcript.
Use only facts that appear in the transcript. If something was not said, leave that list empty or use null.
Every evidence_segment_ids value must be an id copied from the bracketed segment ids.
owner_speaker_id must be one of the speaker ids below, or null when the transcript does not name an owner.
deadline must be null unless the transcript states that deadline in those words.
The transcript may be English, Hindi, or a mix. Write the notes in the language the meeting was mostly conducted in.

Speakers:
${speakerList || "No speakers identified."}

Transcript:
${transcript}`,
    });
    const parsed = notesSchema.parse(result.output);
    const known = new Set(segments.map((segment) => segment.id));
    const content = grounded(
      parsed,
      known,
      new Set(speakers.map((speaker) => speaker.id)),
      segments.map((segment) => segment.text).join("\n"),
    );
    return saveNotes(supabase, userId, meetingId, content);
  } catch (error) {
    const previous = await getNotes(supabase, meetingId);
    await updateMeeting(supabase, userId, meetingId, {
      notesStatus: previous ? "ready" : "failed",
      notesError:
        error instanceof Error
          ? error.message
          : "The model did not return valid notes. Try again.",
    });
    return previous;
  }
}
