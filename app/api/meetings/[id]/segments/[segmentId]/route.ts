import { connection } from "next/server";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { updateSegmentText } from "@/lib/storage/meetings";

type Context = { params: Promise<{ id: string; segmentId: string }> };

export async function PATCH(request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id, segmentId } = await context.params;
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "Transcript text cannot be empty." }, { status: 400 });
  }
  const segment = await updateSegmentText(
    session.supabase,
    session.userId,
    id,
    segmentId,
    text,
  );
  if (!segment) {
    return Response.json({ error: "Segment not found" }, { status: 404 });
  }
  return Response.json(segment);
}
