import { connection } from "next/server";
import { beginTranscription } from "@/lib/speech/sync";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { getMeeting, meetingDetail } from "@/lib/storage/meetings";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const meeting = await getMeeting(session.supabase, id);
  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  try {
    const detail = await beginTranscription(session.supabase, session.userId, id);
    return Response.json(detail);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not retry transcription" },
      { status: 409 },
    );
  }
}

export async function GET(_request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const detail = await meetingDetail(session.supabase, id);
  if (!detail) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  return Response.json({
    status: detail.meeting.status,
    notesStatus: detail.meeting.notesStatus,
    error: detail.meeting.error,
    notesError: detail.meeting.notesError,
  });
}
