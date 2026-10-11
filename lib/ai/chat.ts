import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { relevantSegments } from "@/lib/ai/retrieve";
import { getChatModel } from "@/lib/ai/model";
import { formatTimestamp } from "@/lib/format";
import {
  addMessage,
  getMeeting,
  getNotes,
  listMessages,
  listSegments,
  listSpeakers,
} from "@/lib/storage/meetings";

export function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

const segmentIdPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function citationIds(text: string, known: Set<string>) {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\[segment:([^\]]+)\]/gi)) {
    const id = segmentIdPattern.exec(match[1] ?? "")?.[0];
    if (id && known.has(id)) ids.add(id);
  }
  return [...ids];
}

function meetingTools(supabase: SupabaseClient, meetingId: string) {
  return {
    search_transcript: tool({
      description:
        "Search this meeting's saved transcript. Returns matching lines with segment ids, timestamps, and speaker names.",
      inputSchema: z.object({
        query: z.string().describe("Keywords from the question"),
      }),
      execute: async ({ query }) => {
        const speakers = await listSpeakers(supabase, meetingId);
        const speakerName = (speakerId: string | null) => {
          if (!speakerId) return "Unknown";
          return speakers.find((speaker) => speaker.id === speakerId)?.displayName ?? "Unknown";
        };
        const segments = await relevantSegments(supabase, meetingId, query);
        return segments.slice(0, 12).map((segment) => ({
          id: segment.id,
          timestamp: formatTimestamp(segment.startMs),
          speaker: speakerName(segment.speakerId),
          text: segment.text,
        }));
      },
    }),
    list_speakers: tool({
      description: "List the speakers already saved for this meeting.",
      inputSchema: z.object({}),
      execute: async () =>
        (await listSpeakers(supabase, meetingId)).map((speaker) => ({
          id: speaker.id,
          name: speaker.displayName,
          label: speaker.originalLabel,
        })),
    }),
    read_notes: tool({
      description:
        "Read the notes already saved for this meeting. Returns null when notes have not been written.",
      inputSchema: z.object({}),
      execute: async () => (await getNotes(supabase, meetingId))?.content ?? null,
    }),
  };
}

export async function streamMeetingAnswer(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  messages: UIMessage[],
) {
  const meeting = await getMeeting(supabase, meetingId);
  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const segments = await listSegments(supabase, meetingId);
  if (segments.length === 0) {
    return Response.json(
      { error: "This meeting has no transcript yet." },
      { status: 409 },
    );
  }
  const latest = [...messages].reverse().find((message) => message.role === "user");
  const question = latest ? messageText(latest) : "";
  if (!question.trim()) {
    return Response.json({ error: "Enter a question first." }, { status: 400 });
  }
  let model;
  try {
    model = getChatModel();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The model is not configured." },
      { status: 503 },
    );
  }
  const stored = await listMessages(supabase, meetingId);
  const lastStored = stored.at(-1);
  if (!(lastStored?.role === "user" && lastStored.text === question)) {
    await addMessage(supabase, userId, {
      meetingId,
      role: "user",
      text: question,
      citedSegmentIds: [],
    });
  }
  const known = new Set(segments.map((segment) => segment.id));

  const result = streamText({
    model,
    temperature: 0.2,
    tools: meetingTools(supabase, meetingId),
    stopWhen: stepCountIs(6),
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? "required" : "auto",
    }),
    system: `You answer questions about one meeting. The transcript, speakers, and notes are already saved.
Call 1 to 3 tools before you answer. Search the transcript for the question. Use list_speakers or read_notes only when the question needs them.
If the saved transcript does not contain the answer, say that.
When a line supports a sentence, cite it inline as [segment:ID] using only an id returned by search_transcript. Do not put a timestamp or any other text inside the brackets. Keep the citation on the same line as the words it supports, with one space before it and no line break around it.
Write markdown. Bold each speaker name, and bold the short phrase that directly answers the question. Leave the rest in regular weight. Use a blank line between separate points, or a list when there are several distinct points. Do not break a sentence across lines.
Do not invent speakers, owners, deadlines, or quotes.
The meeting may be in English, Hindi, or both. Answer in the language of the question.`,
    messages: await convertToModelMessages(messages),
    onFinish: async ({ text }) => {
      await addMessage(supabase, userId, {
        meetingId,
        role: "assistant",
        text,
        citedSegmentIds: citationIds(text, known),
      });
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
    onError: (error) =>
      error instanceof Error ? error.message : "The model request failed.",
  });
}
