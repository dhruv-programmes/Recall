import { connection } from "next/server";
import { requireSession, unauthorized } from "@/lib/supabase/server";
import { signedAudioUrl } from "@/lib/storage/meetings";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  await connection();
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await context.params;
  const url = await signedAudioUrl(session.supabase, id);
  if (!url) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }
  return Response.redirect(url, 302);
}
