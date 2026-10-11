import type { MeetingProgress, ProgressPhase } from "@/lib/types";
import type { SpeechJob } from "@/lib/speech/client";

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
