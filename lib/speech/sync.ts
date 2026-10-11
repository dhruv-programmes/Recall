import type { SupabaseClient } from "@supabase/supabase-js";
import { continueNotes, queueNotes } from "@/lib/ai/notes";
import { formatTimestamp } from "@/lib/format";
import { fetchSpeechJob, isCreditError, startSpeechJob, type SpeechJob, type SpeechSlice } from "@/lib/speech/client";
import { progressFromSpeechJob, speechCursor, type SpeechCursor } from "@/lib/speech/progress";
import { SLICE_SECONDS, sliceAudio } from "@/lib/speech/slices";
import {
  appendTranscript,
  getMeeting,
  getMeetingAudioPath,
  getSpeechCursor,
  getSpeechJobId,
  materializeAudio,
  meetingDetail,
  replaceTranscript,
  updateMeeting,
} from "@/lib/storage/meetings";
import type { MeetingProgress } from "@/lib/types";

const syncing = new Set<string>();

function sliceNote(count: number) {
  if (count <= 1) return null;
  return "Speakers are separated inside each 10-minute part. The same name in a later part may be a different person.";
}

function stopMessage(throughMs: number | null, credit: boolean, detail: string | null) {
  const through =
    throughMs != null && throughMs > 0 ? ` Transcribed through ${formatTimestamp(throughMs)}.` : "";
  if (credit && !through) {
    return "Audio is saved. Sarvam credits ran out before transcription started. Add credits and try again.";
  }
  if (credit) return `Audio is saved.${through} Sarvam credits ran out.`;
  if (through) return `Audio is saved.${through} ${detail ?? "Transcription stopped."}`;
  return `Audio is saved. ${detail ?? "Transcription did not start. Try again."}`;
}

function segmentsOf(slice: SpeechSlice) {
  return slice.segments.map((segment) => ({
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
    text: segment.text,
    speakerLabel: segment.speaker_label,
    avgLogprob: segment.avg_logprob,
    noSpeechProb: segment.no_speech_prob,
  }));
}

function progressWithCursor(progress: MeetingProgress, cursor: SpeechCursor) {
  const covered = cursor.nextSlice + (progress.ratio ?? 0) * cursor.batchSize;
  return {
    ...progress,
    ...cursor,
    ratio: cursor.sliceCount > 0 ? Math.min(1, covered / cursor.sliceCount) : progress.ratio,
    durationSeconds: cursor.sliceCount > 0 ? cursor.sliceCount * cursor.sliceSeconds : progress.durationSeconds,
  };
}

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
  const existing = await getSpeechCursor(supabase, meetingId);
  const resume = existing.sliceCount > 0 && existing.nextSlice < existing.sliceCount;
  const local = await materializeAudio(supabase, audioPath);
  try {
    const sliced = await sliceAudio(local.filePath, resume ? existing.nextSlice : 0);
    try {
      if (sliced.files.length === 0) {
        await updateMeeting(supabase, userId, meetingId, {
          status: "ready",
          error: null,
          speechProgress: null,
        });
        return meetingDetail(supabase, meetingId);
      }
      let job: { id: string };
      try {
        job = await startSpeechJob(sliced.files.map((file) => file.path));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start transcription";
        const credit = isCreditError(message);
        await updateMeeting(supabase, userId, meetingId, {
          status: resume ? "ready" : "failed",
          error: stopMessage(resume ? existing.nextSlice * existing.sliceSeconds * 1000 : null, credit, message),
        });
        return meetingDetail(supabase, meetingId);
      }
      const cursor: SpeechCursor = {
        nextSlice: resume ? existing.nextSlice : 0,
        sliceCount: sliced.sliceCount,
        sliceSeconds: SLICE_SECONDS,
        batchSize: sliced.files.length,
        append: resume,
      };
      await updateMeeting(supabase, userId, meetingId, {
        status: "transcribing",
        speechJobId: job.id,
        speechProgress: progressWithCursor(
          { phase: "queued", ratio: 0, processedSeconds: null, durationSeconds: null },
          cursor,
        ),
        startedAt: meeting.startedAt ?? new Date().toISOString(),
        error: null,
        endedAt: null,
      });
    } finally {
      await sliced.cleanup();
    }
  } finally {
    await local.cleanup();
  }
  return meetingDetail(supabase, meetingId);
}

async function saveSlices(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  job: SpeechJob,
  cursor: SpeechCursor,
) {
  let replaced = cursor.append;
  let throughMs = cursor.nextSlice * cursor.sliceSeconds * 1000;
  for (const slice of job.slices) {
    const segments = segmentsOf(slice);
    const durationMs = segments.reduce((max, segment) => Math.max(max, segment.endMs), throughMs);
    const input = {
      language: slice.language ?? job.language,
      durationMs,
      diarizationNote: sliceNote(cursor.sliceCount),
      segments,
    };
    if (!replaced) {
      await replaceTranscript(supabase, meetingId, input);
      replaced = true;
    } else if (segments.length > 0) {
      await appendTranscript(supabase, meetingId, input);
    }
    throughMs = durationMs;
  }
  const nextSlice = cursor.nextSlice + job.slices.length;
  const finished = !job.incomplete && nextSlice >= cursor.sliceCount;
  const nextCursor: SpeechCursor = { ...cursor, nextSlice, batchSize: 0, append: nextSlice > 0 };
  await updateMeeting(supabase, userId, meetingId, {
    status: job.slices.length > 0 || cursor.nextSlice > 0 ? "ready" : "failed",
    error: finished ? null : job.incomplete ? stopMessage(throughMs, job.credit, job.error) : null,
    speechProgress: finished
      ? null
      : progressWithCursor(
          { phase: "transcribing", ratio: 1, processedSeconds: throughMs / 1000, durationSeconds: null },
          nextCursor,
        ),
    endedAt: new Date().toISOString(),
  });
  if (job.slices.length > 0) {
    try {
      await queueNotes(supabase, userId, meetingId, { restart: true });
    } catch {
      // The transcript is already saved. Notes can be started again from the meeting.
    }
  }
  if (!job.incomplete && nextSlice < cursor.sliceCount) {
    try {
      await beginTranscription(supabase, userId, meetingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not continue transcription";
      await updateMeeting(supabase, userId, meetingId, {
        status: "ready",
        error: stopMessage(throughMs, isCreditError(message), message),
      });
    }
  }
}

export async function syncMeeting(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) return null;
  if (meeting.status !== "queued" && meeting.status !== "transcribing") {
    await continueNotes(supabase, userId, meetingId);
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
          const message = error instanceof Error ? error.message : "Could not start transcription";
          await updateMeeting(supabase, userId, meetingId, {
            status: "failed",
            error: stopMessage(null, isCreditError(message), message),
          });
        }
      }
      return meetingDetail(supabase, meetingId);
    }
    const cursor = await getSpeechCursor(supabase, meetingId);
    let job: SpeechJob;
    try {
      job = await fetchSpeechJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the speech job";
      await updateMeeting(supabase, userId, meetingId, {
        status: cursor.nextSlice > 0 ? "ready" : "failed",
        error: stopMessage(
          cursor.nextSlice > 0 ? cursor.nextSlice * cursor.sliceSeconds * 1000 : null,
          isCreditError(message),
          message,
        ),
      });
      return meetingDetail(supabase, meetingId);
    }
    if (job.status === "queued" || job.status === "running") {
      await updateMeeting(supabase, userId, meetingId, {
        status: "transcribing",
        error: null,
        speechProgress: progressWithCursor(progressFromSpeechJob(job), cursor),
      });
      return meetingDetail(supabase, meetingId);
    }
    if (job.slices.length === 0) {
      await updateMeeting(supabase, userId, meetingId, {
        status: cursor.nextSlice > 0 ? "ready" : "failed",
        error: stopMessage(
          cursor.nextSlice > 0 ? cursor.nextSlice * cursor.sliceSeconds * 1000 : null,
          job.credit,
          job.error,
        ),
      });
      return meetingDetail(supabase, meetingId);
    }
    await saveSlices(supabase, userId, meetingId, job, cursor);
    return meetingDetail(supabase, meetingId);
  } finally {
    syncing.delete(meetingId);
  }
}
