import { connection } from "next/server";
import { maxUploadBytes } from "@/lib/env";
import { beginTranscription } from "@/lib/speech/sync";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import {
  listMeetings,
  createMeeting,
  updateMeeting,
  meetingDetail,
  meetingAudioObjectPath,
  uploadMeetingAudio,
} from "@/lib/storage/meetings";
import { extensionForUpload } from "@/lib/storage/paths";
import path from "node:path";

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
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose an audio file." }, { status: 400 });
  }
  if (file.size <= 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > maxUploadBytes()) {
    return Response.json(
      {
        error: `That file is larger than ${Math.round(maxUploadBytes() / (1024 * 1024))} MB.`,
      },
      { status: 413 },
    );
  }
  const extension = extensionForUpload(file.name, file.type);
  if (!extension) {
    return Response.json(
      { error: "Use an audio file such as mp3, wav, m4a, webm, or ogg." },
      { status: 400 },
    );
  }
  const source = form.get("source") === "recording" ? "recording" : "upload";
  const requestedTitle = String(form.get("title") ?? "").trim();
  const fallback =
    source === "recording"
      ? `Recording ${new Date().toLocaleString()}`
      : path.basename(file.name, path.extname(file.name)).trim() || "Untitled meeting";
  const title = (requestedTitle || fallback).slice(0, 120);
  const id = crypto.randomUUID();
  const audioPath = meetingAudioObjectPath(session.userId, id, extension);
  const mime = file.type || "application/octet-stream";
  await uploadMeetingAudio(
    session.supabase,
    audioPath,
    Buffer.from(await file.arrayBuffer()),
    mime,
  );
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
