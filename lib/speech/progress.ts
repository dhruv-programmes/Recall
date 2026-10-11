import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/env";
import type { MeetingProgress, ProgressPhase } from "@/lib/types";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampRatio(value: number | null) {
  if (value == null) return null;
  return Math.min(1, Math.max(0, value));
}

export function readSpeechProgress(jobId: string | null): MeetingProgress | null {
  if (!jobId || !JOB_ID.test(jobId)) return null;
  const file = path.join(dataDir(), "speech-jobs", `${jobId}.json`);
  try {
    const job = JSON.parse(fs.readFileSync(file, "utf8")) as {
      phase?: string;
      progress?: unknown;
      processed_seconds?: unknown;
      duration?: unknown;
      status?: string;
    };
    const phase: ProgressPhase =
      job.phase === "queued" ||
      job.phase === "loading" ||
      job.phase === "diarizing" ||
      job.phase === "transcribing"
        ? job.phase
        : "transcribing";
    return {
      phase,
      ratio: clampRatio(numberOrNull(job.progress)),
      processedSeconds: numberOrNull(job.processed_seconds),
      durationSeconds: numberOrNull(job.duration),
    };
  } catch {
    return null;
  }
}
