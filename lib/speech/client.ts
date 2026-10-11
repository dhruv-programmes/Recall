import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SarvamAIClient } from "sarvamai";
import { sarvamApiKey } from "@/lib/env";
import { SLICE_SECONDS } from "@/lib/speech/slices";

export type SpeechSegment = {
  start: number;
  end: number;
  text: string;
  avg_logprob: number | null;
  no_speech_prob: number | null;
  speaker_label: string | null;
};

export type SpeechSlice = {
  index: number;
  segments: SpeechSegment[];
  language: string | null;
};

export type SpeechJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  phase?: "queued" | "loading" | "transcribing" | "diarizing" | "completed" | null;
  progress?: number | null;
  processed_seconds?: number | null;
  language: string | null;
  duration: number | null;
  diarization_note: string | null;
  segments: SpeechSegment[];
  slices: SpeechSlice[];
  incomplete: boolean;
  credit: boolean;
  error: string | null;
};

type SarvamTranscript = {
  language_code?: string | null;
  timestamps?: {
    chunks?: string[];
    start_time_seconds?: number[];
    end_time_seconds?: number[];
  } | null;
  diarized_transcript?: {
    entries?: Array<{
      transcript?: string;
      start_time_seconds?: number;
      end_time_seconds?: number;
      speaker_id?: string | number | null;
    }>;
  } | null;
};

function sarvamClient() {
  const apiSubscriptionKey = sarvamApiKey();
  if (!apiSubscriptionKey) {
    throw new Error("Set SARVAM_API_KEY in .env, then restart the app.");
  }
  return new SarvamAIClient({ apiSubscriptionKey });
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Sarvam transcription failed";
}

function speakerLabel(id: unknown) {
  if (typeof id === "number" && Number.isInteger(id) && id >= 0) {
    return `SPEAKER_${String(id).padStart(2, "0")}`;
  }
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return `SPEAKER_${trimmed.padStart(2, "0")}`;
  const named = /^SPEAKER_(\d+)$/i.exec(trimmed);
  if (named) return `SPEAKER_${named[1].padStart(2, "0")}`;
  return trimmed;
}

function speakerNote(labels: Array<string | null>) {
  const count = new Set(labels.filter((label) => label)).size;
  if (count === 0) return "Speaker labels were not returned. Lines stay Unknown.";
  if (count === 1) return "One speaker was found. You can rename them in the transcript.";
  return `${count} speakers were separated. Names are placeholders until you edit them.`;
}

function segmentsFromTranscript(body: SarvamTranscript): SpeechSegment[] {
  const entries = body.diarized_transcript?.entries ?? [];
  const diarized = entries
    .map((entry) => ({
      start: Number(entry.start_time_seconds),
      end: Number(entry.end_time_seconds),
      text: (entry.transcript ?? "").trim(),
      avg_logprob: null,
      no_speech_prob: null,
      speaker_label: speakerLabel(entry.speaker_id),
    }))
    .filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end));
  if (diarized.length > 0) return diarized;

  const chunks = body.timestamps?.chunks ?? [];
  const starts = body.timestamps?.start_time_seconds ?? [];
  const ends = body.timestamps?.end_time_seconds ?? [];
  return chunks
    .map((text, index) => ({
      start: Number(starts[index]),
      end: Number(ends[index]),
      text: text.trim(),
      avg_logprob: null,
      no_speech_prob: null,
      speaker_label: null,
    }))
    .filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end));
}

export function isCreditError(message: string | null | undefined) {
  return /insufficient[_\s-]?quota|\bcredits?\b|\bquota\b|billing/i.test(message ?? "");
}

function blankJob(id: string, status: SpeechJob["status"], phase: SpeechJob["phase"]): SpeechJob {
  return {
    id,
    status,
    phase,
    progress: phase === "queued" ? 0 : null,
    processed_seconds: null,
    language: null,
    duration: null,
    diarization_note: null,
    segments: [],
    slices: [],
    incomplete: status === "failed",
    credit: false,
    error: null,
  };
}

function sliceIndex(fileName: string) {
  const match = /^(\d{3})\./.exec(path.basename(fileName));
  return match ? Number(match[1]) : 0;
}

function placeSlice(index: number, segments: SpeechSegment[], multiple: boolean): SpeechSegment[] {
  const scoped = multiple || index > 0;
  const shift = scoped ? index * SLICE_SECONDS : 0;
  return segments.map((segment) => ({
    ...segment,
    start: segment.start + shift,
    end: segment.end + shift,
    speaker_label:
      scoped && segment.speaker_label ? `s${index}:${segment.speaker_label}` : segment.speaker_label,
  }));
}

export function speechHealth() {
  if (!sarvamApiKey()) {
    return {
      ok: false,
      detail: "Set SARVAM_API_KEY in .env, then restart the app.",
    };
  }
  return {
    ok: true,
    detail: "Transcription and speaker labels use Sarvam. Notes and questions use OpenRouter.",
  };
}

export async function startSpeechJob(audioPaths: string[]) {
  if (audioPaths.length === 0) throw new Error("There is no audio left to transcribe.");
  const client = sarvamClient();
  const job = await client.speechToTextJob.createJob({
    model: "saaras:v4",
    mode: "transcribe",
    languageCode: "unknown",
    withDiarization: true,
    withTimestamps: true,
  });
  const uploaded = await job.uploadFiles(audioPaths, 300);
  if (!uploaded) {
    throw new Error("Sarvam did not accept the audio upload.");
  }
  await job.start();
  return { id: job.jobId, status: "queued" as const };
}

export async function fetchSpeechJob(jobId: string): Promise<SpeechJob> {
  const client = sarvamClient();
  const job = client.speechToTextJob.getJob(jobId);
  let status: Awaited<ReturnType<typeof job.getStatus>>;
  try {
    status = await job.getStatus();
  } catch (error) {
    const failed = blankJob(jobId, "failed", "transcribing");
    failed.error = errorMessage(error);
    return failed;
  }

  const state = status.job_state;
  if (state !== "Completed" && state !== "Failed") {
    const running = blankJob(
      jobId,
      state === "Running" ? "running" : "queued",
      state === "Running" ? "transcribing" : "queued",
    );
    const done = status.successful_files_count ?? 0;
    const total = status.total_files ?? 0;
    running.progress = total > 0 ? done / total : running.progress;
    return running;
  }

  const results = await job.getFileResults();
  const multiple = results.successful.length + results.failed.length > 1;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "sarvam-"));
  const byIndex = new Map<number, SpeechSlice>();
  try {
    if (results.successful.length > 0) {
      await job.downloadOutputs(outputDir);
      for (const file of results.successful) {
        const outputName = `${path.basename(file.file_name)}.json`;
        const outputPath = path.join(outputDir, outputName);
        if (!fs.existsSync(outputPath)) continue;
        const body = JSON.parse(fs.readFileSync(outputPath, "utf8")) as SarvamTranscript;
        const index = sliceIndex(file.file_name);
        const segments = placeSlice(index, segmentsFromTranscript(body), multiple || index > 0);
        byIndex.set(index, { index, segments, language: body.language_code ?? null });
      }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  const indexes = [...results.successful, ...results.failed].map((file) => sliceIndex(file.file_name));
  const start = indexes.length > 0 ? Math.min(...indexes) : 0;
  const slices: SpeechSlice[] = [];
  let cursor = start;
  while (byIndex.has(cursor)) {
    slices.push(byIndex.get(cursor)!);
    cursor += 1;
  }
  const failed = results.failed.find((file) => sliceIndex(file.file_name) === cursor);
  const error = failed?.error_message || status.error_message || null;
  const segments = slices.flatMap((slice) => slice.segments);
  const duration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  const incomplete = results.failed.length > 0 || slices.length === 0;
  const finished: SpeechJob = {
    id: jobId,
    status: slices.length > 0 ? "completed" : "failed",
    phase: "completed",
    progress: incomplete ? slices.length / Math.max(1, results.successful.length + results.failed.length) : 1,
    processed_seconds: duration || null,
    language: slices.find((slice) => slice.language)?.language ?? null,
    duration: duration || null,
    diarization_note: speakerNote(segments.map((segment) => segment.speaker_label)),
    segments,
    slices,
    incomplete,
    credit: isCreditError(error),
    error: slices.length > 0 && !incomplete ? null : error || "Sarvam transcription failed",
  };
  return finished;
}
