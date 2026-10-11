import { connection } from "next/server";
import type { UIMessage } from "ai";
import { streamMeetingAnswer } from "@/lib/ai/chat";
import { requireSession, unauthorized } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const body = (await request.json()) as { messages?: UIMessage[] };
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }
  return streamMeetingAnswer(session.supabase, session.userId, id, body.messages);
}
