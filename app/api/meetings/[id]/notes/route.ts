import { connection } from "next/server";
import { queueNotes } from "@/lib/ai/notes";
import { notesSchema } from "@/lib/schemas/notes";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { getMeeting, meetingDetail, saveNotes } from "@/lib/storage/meetings";

export const maxDuration = 60;

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
  if (meeting.status !== "ready") {
    return Response.json(
      { error: "Wait until the transcript is ready." },
      { status: 409 },
    );
  }
  await queueNotes(session.supabase, session.userId, id);
  return Response.json(await meetingDetail(session.supabase, id));
}

export async function PATCH(request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const meeting = await getMeeting(session.supabase, id);
  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const parsed = notesSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Those notes are not in the expected shape." },
      { status: 400 },
    );
  }
  await saveNotes(session.supabase, session.userId, id, parsed.data);
  return Response.json(await meetingDetail(session.supabase, id));
}
