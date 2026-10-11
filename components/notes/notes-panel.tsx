"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { api } from "@/lib/client";
import { formatTimestamp } from "@/lib/format";
import type { MeetingDetail, NotesContent, Segment, Speaker } from "@/lib/types";

const emptyNotes: NotesContent = {
  overview: "",
  key_points: [],
  decisions: [],
  action_items: [],
  open_questions: [],
};

export function NotesPanel({
  detail,
  onChange,
  onOpenSegment,
}: {
  detail: MeetingDetail;
  onChange: () => void;
  onOpenSegment: (segmentId: string) => void;
}) {
  const [draft, setDraft] = useState<NotesContent>(detail.notes?.content ?? emptyNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const segments = new Map(detail.segments.map((segment) => [segment.id, segment]));
  const speakers = new Map(detail.speakers.map((speaker) => [speaker.id, speaker]));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/meetings/${detail.meeting.id}/notes`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setError(null);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save notes.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      await api(`/api/meetings/${detail.meeting.id}/notes`, { method: "POST" });
      setError(null);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not write notes.");
    } finally {
      setBusy(false);
    }
  }

  function evidence(ids: string[]) {
    return ids
      .map((id) => segments.get(id))
      .filter((segment): segment is Segment => Boolean(segment));
  }

  if (detail.meeting.notesStatus === "generating") {
    return <Shimmer>Writing notes from the transcript</Shimmer>;
  }

  if (!detail.notes) {
    return (
      <div className="grid max-w-xl gap-3">
        <p className="leading-7 text-muted-foreground">
          {detail.meeting.notesError ??
            "Notes have not been written yet. They are generated from the saved transcript."}
        </p>
        <Button type="button" className="w-fit" onClick={regenerate} disabled={busy}>
          Write notes
        </Button>
      </div>
    );
  }

  const noteLine =
    "min-h-7 resize-none rounded-md border-transparent bg-transparent px-1 py-0.5 leading-7 shadow-none focus-visible:bg-card";

  return (
    <div className="reading grid gap-8">
      {detail.meeting.notesError ? (
        <p className="text-sm text-destructive" role="alert">
          {detail.meeting.notesError}
        </p>
      ) : null}
      {draft.overview ? (
        <Textarea
          aria-label="Overview"
          rows={2}
          value={draft.overview}
          onChange={(event) => setDraft({ ...draft, overview: event.target.value })}
          className={`${noteLine} text-lg leading-8`}
        />
      ) : null}
      <NoteList
        title="Key points"
        items={draft.key_points}
        onChange={(key_points) => setDraft({ ...draft, key_points })}
        evidence={evidence}
        onOpenSegment={onOpenSegment}
        lineClassName={noteLine}
      />
      <NoteList
        title="Decisions"
        items={draft.decisions}
        onChange={(decisions) => setDraft({ ...draft, decisions })}
        evidence={evidence}
        onOpenSegment={onOpenSegment}
        lineClassName={noteLine}
      />
      {draft.action_items.length > 0 ? (
        <section className="grid gap-3">
          <SectionHeading>Action items</SectionHeading>
          <ul className="grid list-none gap-4">
            {draft.action_items.map((item, index) => {
              const owner = item.owner_speaker_id
                ? speakers.get(item.owner_speaker_id)?.displayName
                : null;
              const meta = [owner, item.deadline].filter(Boolean).join(", ");
              const sources = evidence(item.evidence_segment_ids);
              return (
                <li key={`${item.task}-${index}`} className="grid gap-1">
                  <div className="flex items-start gap-3">
                    <Bullet />
                    <Textarea
                      aria-label={`Action item ${index + 1}`}
                      rows={1}
                      value={item.task}
                      onChange={(event) => {
                        const action_items = draft.action_items.slice();
                        action_items[index] = { ...item, task: event.target.value };
                        setDraft({ ...draft, action_items });
                      }}
                      className={noteLine}
                    />
                  </div>
                  {meta || sources.length > 0 ? (
                    <NestedNotes>
                      {meta ? (
                        <li className="flex items-start gap-2">
                          <span className="mt-2 size-1 shrink-0 rounded-full border border-current" aria-hidden="true" />
                          <span>{meta}</span>
                        </li>
                      ) : null}
                      <EvidenceItems
                        segments={sources}
                        speakers={speakers}
                        onOpenSegment={onOpenSegment}
                      />
                    </NestedNotes>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <NoteList
        title="Open questions"
        items={draft.open_questions}
        onChange={(open_questions) => setDraft({ ...draft, open_questions })}
        evidence={evidence}
        onOpenSegment={onOpenSegment}
        lineClassName={noteLine}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={busy}>
          Save notes
        </Button>
        <Button type="button" variant="outline" onClick={regenerate} disabled={busy}>
          {detail.meeting.notesError ? "Continue notes" : "Write notes again"}
        </Button>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="flex items-baseline gap-2 text-lg font-semibold">
      <span className="font-normal text-muted-foreground" aria-hidden="true">
        #
      </span>
      {children}
    </h2>
  );
}

function Bullet() {
  return <span className="mt-[0.7rem] size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden="true" />;
}

function NestedNotes({ children }: { children: ReactNode }) {
  return <ul className="ml-5 grid list-none gap-1 text-sm leading-6 text-muted-foreground">{children}</ul>;
}

function NoteList({
  title,
  items,
  onChange,
  evidence,
  onOpenSegment,
  lineClassName,
}: {
  title: string;
  items: NotesContent["key_points"];
  onChange: (items: NotesContent["key_points"]) => void;
  evidence: (ids: string[]) => Segment[];
  onOpenSegment: (segmentId: string) => void;
  lineClassName: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="grid gap-3">
      <SectionHeading>{title}</SectionHeading>
      <ul className="grid list-none gap-4">
        {items.map((item, index) => {
          const sources = evidence(item.evidence_segment_ids);
          return (
          <li key={`${title}-${index}`} className="grid gap-1">
            <div className="flex items-start gap-3">
              <Bullet />
              <Textarea
                aria-label={`${title} ${index + 1}`}
                rows={1}
                value={item.text}
                onChange={(event) => {
                  const next = items.slice();
                  next[index] = { ...item, text: event.target.value };
                  onChange(next);
                }}
                className={lineClassName}
              />
            </div>
            {sources.length > 0 ? (
              <NestedNotes>
                <EvidenceItems segments={sources} onOpenSegment={onOpenSegment} />
              </NestedNotes>
            ) : null}
          </li>
          );
        })}
      </ul>
    </section>
  );
}

function EvidenceItems({
  segments,
  speakers,
  onOpenSegment,
}: {
  segments: Segment[];
  speakers?: Map<string, Speaker>;
  onOpenSegment: (segmentId: string) => void;
}) {
  return segments.map((segment) => (
    <li key={segment.id} className="flex items-start gap-2">
      <span className="mt-2 size-1 shrink-0 rounded-full border border-current" aria-hidden="true" />
      <button
        type="button"
        className="text-left underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => onOpenSegment(segment.id)}
      >
        {formatTimestamp(segment.startMs)}
        {speakers && segment.speakerId
          ? ` ${speakers.get(segment.speakerId)?.displayName ?? ""}`
          : ""}
      </button>
    </li>
  ));
}
