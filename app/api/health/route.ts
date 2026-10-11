import { connection } from "next/server";
import { modelHealth } from "@/lib/ai/model";
import { speechHealth } from "@/lib/speech/client";

export async function GET() {
  await connection();
  const [model, speech] = await Promise.all([modelHealth(), speechHealth()]);
  return Response.json({ model, speech });
}
