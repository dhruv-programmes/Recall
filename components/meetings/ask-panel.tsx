"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { defaultComponents } from "streamdown";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { answerMarkdown } from "@/lib/format-answer";
import { formatTimestamp } from "@/lib/format";
import type { ChatMessageRecord, Segment, Speaker } from "@/lib/types";

function toUiMessage(message: ChatMessageRecord): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.text }],
  };
}

export function AskPanel({
  meetingId,
  storedMessages,
  segments,
  speakers,
  onOpenSegment,
}: {
  meetingId: string;
  storedMessages: ChatMessageRecord[];
  segments: Segment[];
  speakers: Speaker[];
  onOpenSegment: (segmentId: string) => void;
}) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/meetings/${meetingId}/chat` }),
    [meetingId],
  );
  const [initialMessages] = useState(() => storedMessages.map(toUiMessage));
  const { messages, sendMessage, status, error, stop } = useChat({
    id: meetingId,
    messages: initialMessages,
    transport,
  });

  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Ask about this meeting"
              description="Answers use the saved transcript and cite the lines they come from."
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent
                  className={message.role === "assistant" ? "reading w-full" : undefined}
                >
                  {message.role === "assistant" ? (
                    <CitedAnswer
                      text={message.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("")}
                      byId={byId}
                      names={names}
                      onOpenSegment={onOpenSegment}
                      streaming={status === "streaming" && message.id === messages.at(-1)?.id}
                    />
                  ) : (
                    <MessageResponse>
                      {message.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("")}
                    </MessageResponse>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" ? <Shimmer>Looking through the transcript</Shimmer> : null}
        </ConversationContent>
      </Conversation>
      {error ? (
        <p className="px-1 py-2 text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      <PromptInput
        className="shrink-0 bg-background px-1 pt-3 pb-1"
        onSubmit={async ({ text }) => {
          const value = text.trim();
          if (!value) return;
          await sendMessage({ text: value });
        }}
      >
        <PromptInputTextarea placeholder="Ask a question about this meeting…" />
        <PromptInputFooter>
          <p className="text-sm text-muted-foreground">GPT-4o mini</p>
          <PromptInputSubmit status={status} onStop={stop} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function CitedAnswer({
  text,
  byId,
  names,
  onOpenSegment,
  streaming,
}: {
  text: string;
  byId: Map<string, Segment>;
  names: Map<string, string>;
  onOpenSegment: (segmentId: string) => void;
  streaming: boolean;
}) {
  const lookup = useRef({ byId, names, onOpenSegment });
  lookup.current = { byId, names, onOpenSegment };
  const components = useMemo(
    () => ({
      a: ({
        href,
        children,
        node: _node,
        ...props
      }: {
        href?: string;
        children?: ReactNode;
        node?: unknown;
      }) => {
        if (href?.startsWith("#segment/")) {
          return (
            <SegmentCitation href={href} lookup={lookup}>
              {children}
            </SegmentCitation>
          );
        }
        const Link = defaultComponents.a;
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      },
    }),
    [],
  );
  const markdown = answerMarkdown(text, byId, names.values());

  return (
    <MessageResponse
      className="[&_[data-streamdown=strong]]:font-bold [&_li]:my-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-4 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
      components={components}
      isAnimating={streaming}
      linkSafety={{ enabled: false }}
      mode={streaming ? "streaming" : "static"}
    >
      {markdown}
    </MessageResponse>
  );
}

function SegmentCitation({
  href,
  children,
  lookup,
}: {
  href: string;
  children: ReactNode;
  lookup: RefObject<{
    byId: Map<string, Segment>;
    names: Map<string, string>;
    onOpenSegment: (segmentId: string) => void;
  }>;
}) {
  const id = href.slice("#segment/".length);
  const segment = lookup.current?.byId.get(id);
  if (!segment) return <span className="text-primary">{children}</span>;
  const speaker = segment.speakerId
    ? (lookup.current?.names.get(segment.speakerId) ?? "Unknown")
    : "Unknown";
  return (
    <InlineCitation className="inline whitespace-nowrap">
      <InlineCitationCard>
        <HoverCardTrigger
          className="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
          render={<span />}
        >
          {children}
        </HoverCardTrigger>
        <InlineCitationCardBody className="w-80 p-3">
          <InlineCitationSource
            title={`${formatTimestamp(segment.startMs)} ${speaker}`}
            description={segment.text}
          />
          <button
            type="button"
            className="mt-2 text-sm text-primary underline-offset-2 hover:underline"
            onClick={() => lookup.current?.onOpenSegment(segment.id)}
          >
            Open in transcript
          </button>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}
