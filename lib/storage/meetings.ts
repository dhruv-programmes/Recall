import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatMessageRecord,
  Meeting,
  MeetingDetail,
  MeetingSource,
  MeetingStatus,
  NotesContent,
  NotesRecord,
  MeetingProgress,
  NotesStatus,
  Segment,
  Speaker,
} from "@/lib/types";
import { formatTimestamp } from "@/lib/format";
import { speechCursor, speechProgress, type SpeechCursor } from "@/lib/speech/progress";

const AUDIO_BUCKET = "meeting-audio";

type MeetingRow = {
  id: string;
  title: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  status: MeetingStatus;
  audio_path: string | null;
  audio_mime: string | null;
  language: string | null;
  speech_job_id: string | null;
  speech_progress: unknown;
  error: string | null;
  source: MeetingSource;
  diarization_note: string | null;
  notes_status: NotesStatus;
  notes_error: string | null;
  notes_progress: unknown;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function progressFor(row: MeetingRow): MeetingProgress | null {
  if (row.notes_status === "generating") {
    return {
      phase: "notes",
      ratio: null,
      processedSeconds: null,
      durationSeconds: null,
    };
  }
  if (row.status === "queued") {
    return { phase: "queued", ratio: 0, processedSeconds: null, durationSeconds: null };
  }
  if (row.status === "transcribing") {
    return (
      speechProgress(row.speech_progress) ?? {
        phase: "transcribing",
        ratio: null,
        processedSeconds: null,
        durationSeconds: null,
      }
    );
  }
  return null;
}

function mapMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    status: row.status,
    audioMime: row.audio_mime,
    language: row.language,
    error: row.error,
    source: row.source,
    diarizationNote: row.diarization_note,
    notesStatus: row.notes_status,
    notesError: row.notes_error,
    progress: progressFor(row),
  };
}

const meetingColumns =
  "id, title, created_at, started_at, ended_at, duration_ms, status, audio_path, audio_mime, language, speech_job_id, speech_progress, error, source, diarization_note, notes_status, notes_error, notes_progress";

async function meetingRow(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("meetings")
    .select(meetingColumns)
    .eq("id", id)
    .maybeSingle();
  fail(error);
  return data as MeetingRow | null;
}

export async function listMeetings(supabase: SupabaseClient, query = "") {
  const trimmed = query.trim();
  let request = supabase
    .from("meetings")
    .select(meetingColumns)
    .order("created_at", { ascending: false });
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`);
    request = request.ilike("title", `%${escaped}%`);
  }
  const { data, error } = await request;
  fail(error);
  return ((data ?? []) as MeetingRow[]).map(mapMeeting);
}

export async function getMeeting(supabase: SupabaseClient, id: string) {
  const row = await meetingRow(supabase, id);
  return row ? mapMeeting(row) : null;
}

export async function getMeetingAudioPath(supabase: SupabaseClient, id: string) {
  return (await meetingRow(supabase, id))?.audio_path ?? null;
}

export async function signedAudioUrl(supabase: SupabaseClient, id: string) {
  const audioPath = await getMeetingAudioPath(supabase, id);
  if (!audioPath) return null;
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(audioPath, 60 * 60);
  fail(error);
  return data?.signedUrl ?? null;
}

export async function materializeAudio(supabase: SupabaseClient, audioPath: string) {
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(audioPath);
  if (error || !data) {
    throw new Error(error?.message ?? "Could not read the audio.");
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-audio-"));
  const filePath = path.join(directory, path.basename(audioPath));
  await fs.writeFile(filePath, Buffer.from(await data.arrayBuffer()));
  return {
    filePath,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

export async function uploadMeetingAudio(
  supabase: SupabaseClient,
  audioPath: string,
  body: Buffer,
  mime: string,
) {
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(audioPath, body, {
    contentType: mime,
    upsert: false,
  });
  fail(error);
}

export async function getSpeechJobId(supabase: SupabaseClient, id: string) {
  return (await meetingRow(supabase, id))?.speech_job_id ?? null;
}

export async function getSpeechCursor(supabase: SupabaseClient, id: string) {
  return speechCursor((await meetingRow(supabase, id))?.speech_progress);
}

export async function getNotesProgress(supabase: SupabaseClient, id: string) {
  return (await meetingRow(supabase, id))?.notes_progress ?? null;
}

export async function createMeeting(
  supabase: SupabaseClient,
  userId: string,
  input: {
    id: string;
    title: string;
    source: MeetingSource;
    audioPath: string;
    audioMime: string;
  },
) {
  const { error } = await supabase.from("meetings").insert({
    id: input.id,
    user_id: userId,
    title: input.title,
    status: "queued",
    audio_path: input.audioPath,
    audio_mime: input.audioMime,
    source: input.source,
    notes_status: "empty",
  });
  fail(error);
  return (await getMeeting(supabase, input.id))!;
}

export async function updateMeeting(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    status: MeetingStatus;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    language: string | null;
    speechJobId: string | null;
    error: string | null;
    diarizationNote: string | null;
    notesStatus: NotesStatus;
    notesError: string | null;
    notesProgress: unknown;
    speechProgress: (MeetingProgress & Partial<SpeechCursor>) | null;
  }>,
) {
  const current = await meetingRow(supabase, id);
  if (!current) return null;
  const { error } = await supabase
    .from("meetings")
    .update({
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      started_at: patch.startedAt === undefined ? current.started_at : patch.startedAt,
      ended_at: patch.endedAt === undefined ? current.ended_at : patch.endedAt,
      duration_ms: patch.durationMs === undefined ? current.duration_ms : patch.durationMs,
      language: patch.language === undefined ? current.language : patch.language,
      speech_job_id:
        patch.speechJobId === undefined ? current.speech_job_id : patch.speechJobId,
      speech_progress:
        patch.speechProgress === undefined ? current.speech_progress : patch.speechProgress,
      error: patch.error === undefined ? current.error : patch.error,
      diarization_note:
        patch.diarizationNote === undefined
          ? current.diarization_note
          : patch.diarizationNote,
      notes_status: patch.notesStatus ?? current.notes_status,
      notes_error: patch.notesError === undefined ? current.notes_error : patch.notesError,
      notes_progress:
        patch.notesProgress === undefined ? current.notes_progress : patch.notesProgress,
    })
    .eq("id", id)
    .eq("user_id", userId);
  fail(error);
  return getMeeting(supabase, id);
}

export async function listSpeakers(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<Speaker[]> {
  const { data, error } = await supabase
    .from("speakers")
    .select("id, meeting_id, display_name, original_label")
    .eq("meeting_id", meetingId)
    .order("display_name");
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    displayName: row.display_name,
    originalLabel: row.original_label,
  }));
}

export async function listSegments(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<Segment[]> {
  const { data, error } = await supabase
    .from("segments")
    .select("id, meeting_id, speaker_id, start_ms, end_ms, text, language")
    .eq("meeting_id", meetingId)
    .order("start_ms")
    .order("id");
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    speakerId: row.speaker_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    language: row.language,
  }));
}

export async function replaceTranscript(
  supabase: SupabaseClient,
  meetingId: string,
  input: {
    language: string | null;
    durationMs: number | null;
    diarizationNote: string | null;
    segments: Array<{
      startMs: number;
      endMs: number;
      text: string;
      speakerLabel: string | null;
      avgLogprob: number | null;
      noSpeechProb: number | null;
    }>;
  },
) {
  const labels = input.segments.map((segment) => segment.speakerLabel);
  const speakers = new Map<string, string>();
  const speakerRows = [];
  const segmentRows = [];
  for (const segment of input.segments) {
    const key = segment.speakerLabel ?? "";
    let speakerId = speakers.get(key);
    if (!speakerId) {
      speakerId = crypto.randomUUID();
      speakers.set(key, speakerId);
      speakerRows.push({
        id: speakerId,
        display_name: displayNameFor(segment.speakerLabel, labels).slice(0, 80),
        original_label: segment.speakerLabel,
      });
    }
    segmentRows.push({
      id: crypto.randomUUID(),
      speaker_id: speakerId,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      text: segment.text,
      avg_logprob: segment.avgLogprob,
      no_speech_prob: segment.noSpeechProb,
    });
  }
  const { error } = await supabase.rpc("replace_meeting_transcript", {
    p_meeting_id: meetingId,
    p_language: input.language,
    p_duration_ms: input.durationMs,
    p_diarization_note: input.diarizationNote,
    p_speakers: speakerRows,
    p_segments: segmentRows,
  });
  fail(error);
}

export async function appendTranscript(
  supabase: SupabaseClient,
  meetingId: string,
  input: {
    language: string | null;
    durationMs: number | null;
    diarizationNote: string | null;
    segments: Array<{
      startMs: number;
      endMs: number;
      text: string;
      speakerLabel: string | null;
      avgLogprob: number | null;
      noSpeechProb: number | null;
    }>;
  },
) {
  const labels = input.segments.map((segment) => segment.speakerLabel);
  const speakers = new Map<string, string>();
  const speakerRows = [];
  const segmentRows = [];
  for (const segment of input.segments) {
    const key = segment.speakerLabel ?? "";
    let speakerId = speakers.get(key);
    if (!speakerId) {
      speakerId = crypto.randomUUID();
      speakers.set(key, speakerId);
      speakerRows.push({
        id: speakerId,
        display_name: displayNameFor(segment.speakerLabel, labels).slice(0, 80),
        original_label: segment.speakerLabel,
      });
    }
    segmentRows.push({
      id: crypto.randomUUID(),
      speaker_id: speakerId,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      text: segment.text,
      avg_logprob: segment.avgLogprob,
      no_speech_prob: segment.noSpeechProb,
    });
  }
  const { error } = await supabase.rpc("append_meeting_transcript", {
    p_meeting_id: meetingId,
    p_language: input.language,
    p_duration_ms: input.durationMs,
    p_diarization_note: input.diarizationNote,
    p_speakers: speakerRows,
    p_segments: segmentRows,
  });
  fail(error);
}

function speakerIndex(label: string | null) {
  const match = label ? /SPEAKER_(\d+)/i.exec(label) : null;
  return match ? Number(match[1]) : null;
}

function displayNameFor(label: string | null, labels: Array<string | null>) {
  if (!label) return "Unknown";
  const scoped = /^s(\d+):(.*)$/.exec(label);
  const inner = scoped ? scoped[2] : label;
  const index = speakerIndex(inner);
  if (index == null) return inner || label;
  const zeroBased = labels.some((item) => {
    const nested = item ? /^s\d+:(.*)$/.exec(item) : null;
    return speakerIndex(nested ? nested[1] : item) === 0;
  });
  const name = `Speaker ${zeroBased ? index + 1 : index}`;
  if (!scoped) return name;
  return `${name} · ${formatTimestamp(Number(scoped[1]) * 600 * 1000)}`;
}

export async function updateSegmentText(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  segmentId: string,
  text: string,
) {
  const { data, error } = await supabase
    .from("segments")
    .update({ text })
    .eq("id", segmentId)
    .eq("meeting_id", meetingId)
    .eq("user_id", userId)
    .select("id, meeting_id, speaker_id, start_ms, end_ms, text, language")
    .maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    id: data.id,
    meetingId: data.meeting_id,
    speakerId: data.speaker_id,
    startMs: data.start_ms,
    endMs: data.end_ms,
    text: data.text,
    language: data.language,
  } satisfies Segment;
}

export async function renameSpeaker(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  speakerId: string,
  displayName: string,
) {
  const { data, error } = await supabase
    .from("speakers")
    .update({ display_name: displayName })
    .eq("id", speakerId)
    .eq("meeting_id", meetingId)
    .eq("user_id", userId)
    .select("id, meeting_id, display_name, original_label")
    .maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    id: data.id,
    meetingId: data.meeting_id,
    displayName: data.display_name,
    originalLabel: data.original_label,
  } satisfies Speaker;
}

export async function getNotes(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<NotesRecord | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, meeting_id, content, created_at, updated_at, version")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    id: data.id,
    meetingId: data.meeting_id,
    content: data.content as NotesContent,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    version: data.version,
  };
}

export async function saveNotes(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  content: NotesContent,
  options?: {
    notesStatus?: NotesStatus;
    notesError?: string | null;
    notesProgress?: unknown;
  },
) {
  const current = await getNotes(supabase, meetingId);
  if (!current) {
    const { error } = await supabase.from("notes").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      meeting_id: meetingId,
      content,
      version: 1,
    });
    fail(error);
  } else {
    const { error } = await supabase
      .from("notes")
      .update({
        content,
        updated_at: new Date().toISOString(),
        version: current.version + 1,
      })
      .eq("id", current.id)
      .eq("user_id", userId);
    fail(error);
  }
  await updateMeeting(supabase, userId, meetingId, {
    notesStatus: options?.notesStatus ?? "ready",
    notesError: options?.notesError === undefined ? null : options.notesError,
    ...(options && "notesProgress" in options ? { notesProgress: options.notesProgress } : {}),
  });
  return getNotes(supabase, meetingId);
}

export async function listMessages(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<ChatMessageRecord[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, meeting_id, role, text, cited_segment_ids, created_at")
    .eq("meeting_id", meetingId)
    .order("created_at");
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    role: row.role,
    text: row.text,
    citedSegmentIds: row.cited_segment_ids ?? [],
    createdAt: row.created_at,
  }));
}

export async function addMessage(
  supabase: SupabaseClient,
  userId: string,
  input: {
    meetingId: string;
    role: "user" | "assistant";
    text: string;
    citedSegmentIds: string[];
  },
) {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("chat_messages").insert({
    id,
    user_id: userId,
    meeting_id: input.meetingId,
    role: input.role,
    text: input.text,
    cited_segment_ids: input.citedSegmentIds,
  });
  fail(error);
  return id;
}

export async function searchSegmentIds(
  supabase: SupabaseClient,
  meetingId: string,
  ftsQuery: string,
) {
  const { data, error } = await supabase
    .from("segments")
    .select("id")
    .eq("meeting_id", meetingId)
    .textSearch("search_vector", ftsQuery, { type: "websearch", config: "simple" })
    .limit(24);
  fail(error);
  return (data ?? []).map((row) => row.id);
}

export async function deleteMeeting(
  supabase: SupabaseClient,
  userId: string,
  id: string,
) {
  const audioPath = await getMeetingAudioPath(supabase, id);
  if (audioPath) {
    const removed = await supabase.storage.from(AUDIO_BUCKET).remove([audioPath]);
    if (removed.error && !/not found/i.test(removed.error.message)) {
      throw new Error(removed.error.message);
    }
  }
  const { data, error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  fail(error);
  return (data ?? []).length > 0;
}

export async function meetingDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<MeetingDetail | null> {
  const meeting = await getMeeting(supabase, id);
  if (!meeting) return null;
  const [speakers, segments, notes, messages] = await Promise.all([
    listSpeakers(supabase, id),
    listSegments(supabase, id),
    getNotes(supabase, id),
    listMessages(supabase, id),
  ]);
  return { meeting, speakers, segments, notes, messages };
}

export function meetingAudioObjectPath(userId: string, meetingId: string, extension: string) {
  return `${userId}/${meetingId}${extension}`;
}
