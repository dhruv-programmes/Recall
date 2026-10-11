import type { SupabaseClient } from "@supabase/supabase-js";
import { queueNotes } from "@/lib/ai/notes";
import {
  fetchSpeechJob,
  startSpeechJob,
  type SpeechJob,
} from "@/lib/speech/client";
import {
  getMeeting,
  getMeetingAudioPath,
  getSpeechJobId,
  materializeAudio,
  meetingDetail,
  replaceTranscript,
  updateMeeting,
} from "@/lib/storage/meetings";

const syncing = new Set<string>();

export async function beginTranscription(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) throw new Error("Meeting not found");
  if (meeting.status === "transcribing") {
    throw new Error("This meeting is already transcribing");
  }
  const audioPath = await getMeetingAudioPath(supabase, meetingId);
  if (!audioPath) throw new Error("This meeting has no audio file");
  const local = await materializeAudio(supabase, audioPath);
  try {
    const job = await startSpeechJob(local.filePath);
    await updateMeeting(supabase, userId, meetingId, {
      status: "transcribing",
      speechJobId: job.id,
      startedAt: new Date().toISOString(),
      error: null,
      endedAt: null,
    });
  } finally {
    await local.cleanup();
  }
  return meetingDetail(supabase, meetingId);
}

export async function syncMeeting(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) return null;
  if (meeting.status !== "queued" && meeting.status !== "transcribing") {
    return meetingDetail(supabase, meetingId);
  }
  if (syncing.has(meetingId)) return meetingDetail(supabase, meetingId);
  syncing.add(meetingId);
  try {
    const jobId = await getSpeechJobId(supabase, meetingId);
    if (!jobId) {
      if (meeting.status === "queued") {
        try {
          await beginTranscription(supabase, userId, meetingId);
        } catch (error) {
          await updateMeeting(supabase, userId, meetingId, {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Could not start transcription",
          });
        }
      }
      return meetingDetail(supabase, meetingId);
    }
    let job: SpeechJob;
    try {
      job = await fetchSpeechJob(jobId);
    } catch (error) {
      await updateMeeting(supabase, userId, meetingId, {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Could not read the speech job",
      });
      return meetingDetail(supabase, meetingId);
    }
    if (job.status === "queued" || job.status === "running") {
      await updateMeeting(supabase, userId, meetingId, { status: "transcribing", error: null });
      return meetingDetail(supabase, meetingId);
    }
    if (job.status === "failed") {
      await updateMeeting(supabase, userId, meetingId, {
        status: "failed",
        error: job.error ?? "Transcription failed",
      });
      return meetingDetail(supabase, meetingId);
    }
    const current = await getMeeting(supabase, meetingId);
    if (current?.status === "ready") return meetingDetail(supabase, meetingId);
    await replaceTranscript(supabase, meetingId, {
      language: job.language,
      durationMs: job.duration == null ? null : Math.round(job.duration * 1000),
      diarizationNote: job.diarization_note,
      segments: job.segments.map((segment) => ({
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        text: segment.text,
        speakerLabel: segment.speaker_label,
        avgLogprob: segment.avg_logprob,
        noSpeechProb: segment.no_speech_prob,
      })),
    });
    await queueNotes(supabase, userId, meetingId);
    return meetingDetail(supabase, meetingId);
  } finally {
    syncing.delete(meetingId);
  }
}
