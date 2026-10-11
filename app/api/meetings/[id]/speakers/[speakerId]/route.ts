import { connection } from "next/server";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { renameSpeaker } from "@/lib/storage/meetings";

type Context = { params: Promise<{ id: string; speakerId: string }> };

export async function PATCH(request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id, speakerId } = await context.params;
  const body = (await request.json()) as { displayName?: string };
  const displayName = body.displayName?.trim();
  if (!displayName) {
    return Response.json({ error: "Enter a speaker name." }, { status: 400 });
  }
  const speaker = await renameSpeaker(
    session.supabase,
    session.userId,
    id,
    speakerId,
    displayName.slice(0, 80),
  );
  if (!speaker) {
    return Response.json({ error: "Speaker not found" }, { status: 404 });
  }
  return Response.json(speaker);
}
