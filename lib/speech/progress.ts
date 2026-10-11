import type { MeetingProgress, ProgressPhase } from "@/lib/types";
import type { SpeechJob } from "@/lib/speech/client";

export type SpeechCursor = {
  nextSlice: number;
  sliceCount: number;
  sliceSeconds: number;
  batchSize: number;
  append: boolean;
};

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampRatio(value: number | null) {
  if (value == null) return null;
  return Math.min(1, Math.max(0, value));
}

export function speechProgress(value: unknown): MeetingProgress | null {
  if (!value || typeof value !== "object") return null;
  const job = value as {
    phase?: unknown;
    ratio?: unknown;
    processedSeconds?: unknown;
    durationSeconds?: unknown;
  };
  const phase: ProgressPhase =
    job.phase === "queued" ||
    job.phase === "loading" ||
    job.phase === "diarizing" ||
    job.phase === "transcribing" ||
    job.phase === "notes"
      ? job.phase
      : "transcribing";
  return {
    phase,
    ratio: clampRatio(numberOrNull(job.ratio)),
    processedSeconds: numberOrNull(job.processedSeconds),
    durationSeconds: numberOrNull(job.durationSeconds),
  };
}

export function speechCursor(value: unknown): SpeechCursor {
  const cursor =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof SpeechCursor, unknown>>)
      : {};
  return {
    nextSlice: typeof cursor.nextSlice === "number" ? cursor.nextSlice : 0,
    sliceCount: typeof cursor.sliceCount === "number" ? cursor.sliceCount : 0,
    sliceSeconds: typeof cursor.sliceSeconds === "number" ? cursor.sliceSeconds : 600,
    batchSize: typeof cursor.batchSize === "number" ? cursor.batchSize : 1,
    append: cursor.append === true,
  };
}

export function progressFromSpeechJob(job: SpeechJob): MeetingProgress {
  const phase: ProgressPhase =
    job.phase === "queued" || job.phase === "loading" || job.phase === "diarizing" || job.phase === "transcribing"
      ? job.phase
      : job.status === "queued"
        ? "queued"
        : "transcribing";
  return {
    phase,
    ratio: clampRatio(numberOrNull(job.progress)),
    processedSeconds: numberOrNull(job.processed_seconds),
    durationSeconds: numberOrNull(job.duration),
  };
}
