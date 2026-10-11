import { z } from "zod";

const evidence = z.array(z.string());

export const noteItemSchema = z.object({
  text: z.string(),
  evidence_segment_ids: evidence,
});

export const notesSchema = z.object({
  overview: z.string(),
  key_points: z.array(noteItemSchema),
  decisions: z.array(noteItemSchema),
  action_items: z.array(
    z.object({
      task: z.string(),
      owner_speaker_id: z.string().nullable(),
      deadline: z.string().nullable(),
      evidence_segment_ids: evidence,
    }),
  ),
  open_questions: z.array(noteItemSchema),
});
