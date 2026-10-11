import type { MeetingProgress } from "@/lib/types";

export function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDuration(ms: number | null) {
  if (ms == null) return null;
  return formatTimestamp(ms);
}

export function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "transcribing":
      return "Transcribing";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "generating":
      return "Writing notes";
    case "empty":
      return "No notes yet";
    default:
      return status;
  }
}

export function progressLabel(progress: MeetingProgress) {
  switch (progress.phase) {
    case "queued":
      return "Waiting to start transcription";
    case "loading":
      return "Loading the speech model";
    case "transcribing":
      return "Transcribing";
    case "diarizing":
      return "Identifying speakers";
    case "notes":
      return "Writing notes";
  }
}

export function progressPercent(progress: MeetingProgress) {
  if (progress.ratio == null) return null;
  return Math.round(Math.min(1, Math.max(0, progress.ratio)) * 100);
}

export function progressDetail(progress: MeetingProgress) {
  if (
    progress.phase !== "transcribing" ||
    progress.processedSeconds == null ||
    progress.durationSeconds == null ||
    progress.durationSeconds <= 0
  ) {
    return null;
  }
  return `${formatTimestamp(progress.processedSeconds * 1000)} of ${formatTimestamp(progress.durationSeconds * 1000)}`;
}
