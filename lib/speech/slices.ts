import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

export const SLICE_SECONDS = 600;
const MAX_FILES = 20;

export type AudioSlice = {
  index: number;
  path: string;
};

function exec(binary: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(binary, args, { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) {
        const failure = error as Error & { stderr?: string };
        failure.stderr = stderr;
        reject(failure);
        return;
      }
      resolve(stderr);
    });
  });
}

async function durationSeconds(binary: string, filePath: string) {
  try {
    await exec(binary, ["-hide_banner", "-i", filePath]);
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  return null;
}

export async function sliceAudio(inputPath: string, fromIndex: number) {
  const binary = ffmpegPath;
  const extension = path.extname(inputPath) || ".audio";
  if (!binary) {
    if (fromIndex > 0) throw new Error("Could not continue the remaining audio.");
    return { sliceCount: 1, files: [{ index: 0, path: inputPath }], cleanup: async () => {} };
  }
  const duration = await durationSeconds(binary, inputPath);
  if (duration == null) {
    if (fromIndex > 0) throw new Error("Could not continue the remaining audio.");
    return { sliceCount: 1, files: [{ index: 0, path: inputPath }], cleanup: async () => {} };
  }
  const sliceCount = Math.max(1, Math.ceil(duration / SLICE_SECONDS));
  if (fromIndex >= sliceCount) {
    return { sliceCount, files: [], cleanup: async () => {} };
  }
  if (sliceCount === 1) {
    return { sliceCount: 1, files: [{ index: 0, path: inputPath }], cleanup: async () => {} };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-slices-"));
  const files: AudioSlice[] = [];
  try {
    for (let index = fromIndex; index < sliceCount && files.length < MAX_FILES; index += 1) {
      const filePath = path.join(directory, `${String(index).padStart(3, "0")}${extension}`);
      await exec(binary, [
        "-y",
        "-ss",
        String(index * SLICE_SECONDS),
        "-t",
        String(SLICE_SECONDS),
        "-i",
        inputPath,
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        filePath,
      ]);
      files.push({ index, path: filePath });
    }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    if (fromIndex === 0) {
      return { sliceCount: 1, files: [{ index: 0, path: inputPath }], cleanup: async () => {} };
    }
    throw error;
  }
  return {
    sliceCount,
    files,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}
