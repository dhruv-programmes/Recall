import { connection } from "next/server";
import { syncMeeting } from "@/lib/speech/sync";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { deleteMeeting, meetingDetail, updateMeeting } from "@/lib/storage/meetings";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const detail = await syncMeeting(session.supabase, session.userId, id);
  if (!detail) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  return Response.json(detail);
}

export async function PATCH(request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title) {
    return Response.json({ error: "Enter a title." }, { status: 400 });
  }
  const meeting = await updateMeeting(session.supabase, session.userId, id, {
    title: title.slice(0, 120),
  });
  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  return Response.json(await meetingDetail(session.supabase, id));
}

export async function DELETE(_request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const removed = await deleteMeeting(session.supabase, session.userId, id);
  if (!removed) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
