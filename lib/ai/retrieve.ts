import type { SupabaseClient } from "@supabase/supabase-js";
import { listSegments, searchSegmentIds } from "@/lib/storage/meetings";
import type { Segment } from "@/lib/types";

export function ftsQuery(input: string) {
  const terms = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.join(" or ");
}

export async function relevantSegments(
  supabase: SupabaseClient,
  meetingId: string,
  question: string,
) {
  const all = await listSegments(supabase, meetingId);
  const query = ftsQuery(question);
  if (!query) return all.slice(0, 40);
  let ids: string[] = [];
  try {
    ids = await searchSegmentIds(supabase, meetingId, query);
  } catch {
    return all.slice(0, 40);
  }
  if (ids.length === 0) return all.slice(0, 40);
  const byId = new Map(all.map((segment) => [segment.id, segment]));
  const picked = ids
    .map((id) => byId.get(id))
    .filter((segment): segment is Segment => Boolean(segment));
  return picked.length > 0 ? picked : all.slice(0, 40);
}
