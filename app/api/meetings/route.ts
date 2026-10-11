import { connection } from "next/server";
import { beginTranscription } from "@/lib/speech/sync";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import {
  listMeetings,
  createMeeting,
  updateMeeting,
  meetingDetail,
  meetingAudioObjectPath,
} from "@/lib/storage/meetings";
import path from "node:path";

export const maxDuration = 60;

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

export async function GET(request: Request) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const meetings = await listMeetings(session.supabase, query);
  return Response.json({ meetings });
}

export async function POST(request: Request) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    title?: string;
    source?: string;
    audioPath?: string;
    audioMime?: string;
  } | null;
  const id = body?.id ?? "";
  const audioPath = body?.audioPath ?? "";
  const extension = path.posix.extname(audioPath).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    !AUDIO_EXTENSIONS.has(extension) ||
    audioPath !== meetingAudioObjectPath(session.userId, id, extension)
  ) {
    return Response.json({ error: "That audio upload is not valid." }, { status: 400 });
  }
  const source = body?.source === "recording" ? "recording" : "upload";
  const requestedTitle = String(body?.title ?? "").trim();
  const fallback = source === "recording" ? `Recording ${new Date().toLocaleString()}` : "Untitled meeting";
  const title = (requestedTitle || fallback).slice(0, 120);
  const mime = body?.audioMime?.trim() || "application/octet-stream";
  await createMeeting(session.supabase, session.userId, {
    id,
    title,
    source,
    audioPath,
    audioMime: mime,
  });
  try {
    await beginTranscription(session.supabase, session.userId, id);
  } catch (error) {
    await updateMeeting(session.supabase, session.userId, id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Could not start transcription",
    });
  }
  return Response.json(await meetingDetail(session.supabase, id), { status: 201 });
}
