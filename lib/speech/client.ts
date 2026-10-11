import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SarvamAIClient } from "sarvamai";
import { sarvamApiKey } from "@/lib/env";

export type SpeechSegment = {
  start: number;
  end: number;
  text: string;
  avg_logprob: number | null;
  no_speech_prob: number | null;
  speaker_label: string | null;
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
    error: null,
  };
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

export async function startSpeechJob(audioPath: string) {
  const client = sarvamClient();
  const job = await client.speechToTextJob.createJob({
    model: "saaras:v4",
    mode: "transcribe",
    languageCode: "unknown",
    withDiarization: true,
    withTimestamps: true,
  });
  const uploaded = await job.uploadFiles([audioPath], 300);
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
  if (state === "Failed") {
    const failed = blankJob(jobId, "failed", "transcribing");
    failed.error = status.error_message || "Sarvam transcription failed";
    return failed;
  }
  if (state !== "Completed") {
    return blankJob(
      jobId,
      state === "Running" ? "running" : "queued",
      state === "Running" ? "transcribing" : "queued",
    );
  }

  const results = await job.getFileResults();
  if (results.successful.length === 0) {
    const failed = blankJob(jobId, "failed", "transcribing");
    failed.error = results.failed[0]?.error_message || status.error_message || "Sarvam transcription failed";
    return failed;
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "sarvam-"));
  let body: SarvamTranscript;
  try {
    await job.downloadOutputs(outputDir);
    const outputName = fs.readdirSync(outputDir).find((name) => name.endsWith(".json"));
    if (!outputName) {
      const failed = blankJob(jobId, "failed", "transcribing");
      failed.error = "Sarvam finished without a transcript file.";
      return failed;
    }
    body = JSON.parse(fs.readFileSync(path.join(outputDir, outputName), "utf8")) as SarvamTranscript;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  const segments = segmentsFromTranscript(body);
  const duration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  const completed: SpeechJob = {
    id: jobId,
    status: "completed",
    phase: "completed",
    progress: 1,
    processed_seconds: duration || null,
    language: body.language_code ?? null,
    duration: duration || null,
    diarization_note: speakerNote(segments.map((segment) => segment.speaker_label)),
    segments,
    error: null,
  };
  return completed;
}
