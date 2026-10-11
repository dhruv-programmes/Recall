import path from "node:path";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".mp4",
  ".webm",
  ".ogg",
  ".flac",
  ".aac",
]);

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": ".webm",
  "video/webm": ".webm",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
};

export function extensionForUpload(filename: string, mime: string) {
  const fromName = path.extname(filename).toLowerCase();
  if (AUDIO_EXTENSIONS.has(fromName)) return fromName;
  const baseMime = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXTENSIONS[baseMime] ?? null;
}
