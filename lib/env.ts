import path from "node:path";

export function dataDir() {
  return path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function maxUploadBytes() {
  const raw = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);
  return Number.isFinite(raw) && raw > 0 ? raw : 200 * 1024 * 1024;
}

export function openRouterApiKey() {
  return (process.env.OPENROUTER_API_KEY ?? "").trim();
}

export function openRouterModel() {
  return (process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini").trim() || "openai/gpt-4o-mini";
}

export function openAiApiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

export function sarvamApiKey() {
  return (process.env.SARVAM_API_KEY ?? "").trim();
}
