"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ProcessingProgress } from "@/components/meetings/processing-progress";
import { MeetingShell } from "@/components/meetings/shell";
import { AskPanel } from "@/components/meetings/ask-panel";
import { NotesPanel } from "@/components/notes/notes-panel";
import { TranscriptPanel } from "@/components/transcript/transcript-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/client";
import { takeOpenOnTranscript } from "@/lib/open-meeting-tab";
import type { MeetingDetail } from "@/lib/types";

function DiarizationNotice({
  canSeparate,
  onSeparate,
}: {
  canSeparate: boolean;
  onSeparate: () => void;
}) {
  if (!canSeparate) return null;
  return (
    <Button type="button" variant="outline" className="w-fit" onClick={onSeparate}>
      Separate speakers again
    </Button>
  );
}

export function MeetingScreen({
  meetingId,
  initialTab = "summary",
}: {
  meetingId: string;
  initialTab?: "summary" | "transcript";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript" | "ask">(initialTab);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useLayoutEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    const fromRecording = takeOpenOnTranscript(meetingId);
    if (fromRecording || fromUrl === "transcript" || requestedTab === "transcript") {
      setTab("transcript");
      return;
    }
    if (fromUrl === "ask" || requestedTab === "ask") {
      setTab("ask");
      return;
    }
    setTab("summary");
  }, [meetingId, requestedTab]);

  const load = useCallback(async () => {
    try {
      const next = await api<MeetingDetail>(`/api/meetings/${meetingId}`);
      setDetail(next);
      setTitle(next.meeting.title);
      setError(null);
      return next;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not open this meeting.");
      return null;
    }
  }, [meetingId]);

  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const tick = async () => {
      const next = await load();
      if (cancelled || !next) return;
      const pending =
        next.meeting.status === "queued" ||
        next.meeting.status === "transcribing" ||
        next.meeting.notesStatus === "generating";
      if (pending) timer = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const field = titleRef.current;
    if (!field) return;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [title]);

  function openSegment(segmentId: string) {
    setFocusId(segmentId);
    setTab("transcript");
  }

  async function saveTitle() {
    if (!detail || title.trim() === detail.meeting.title) return;
    try {
      await api(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      });
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not rename the meeting.");
    }
  }

  async function retry() {
    try {
      await api(`/api/meetings/${meetingId}/process`, { method: "POST" });
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not retry transcription.");
    }
  }

  async function remove() {
    try {
      await api(`/api/meetings/${meetingId}`, { method: "DELETE" });
      toast.success("Meeting deleted.");
      router.push("/");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete the meeting.");
    }
  }

  return (
    <MeetingShell activeId={meetingId}>
      <main id="main" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-4 py-6 md:px-8 md:py-8">
        {!detail && !error ? (
          <div className="grid max-w-xl gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {detail ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
            <div className="flex shrink-0 min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 flex-1 gap-2">
                <Textarea
                  ref={titleRef}
                  aria-label="Meeting title"
                  name="title"
                  autoComplete="off"
                  rows={1}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={saveTitle}
                  className="field-sizing-fixed min-h-0 w-full max-w-full resize-none overflow-hidden border-transparent bg-transparent px-0 py-0 text-3xl leading-tight font-semibold break-words shadow-none focus-visible:border-border focus-visible:ring-0 md:text-4xl"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
                Delete meeting
              </Button>
            </div>
            {detail.meeting.error ? (
              <div className="grid max-w-xl gap-3 rounded-lg border border-border bg-card p-4">
                <p className="text-sm leading-6" role="alert">
                  {detail.meeting.error}
                </p>
                <Button type="button" className="w-fit" onClick={retry}>
                  {detail.meeting.status === "ready" ? "Continue transcription" : "Retry transcription"}
                </Button>
              </div>
            ) : null}
            {detail.meeting.progress ? (
              <ProcessingProgress progress={detail.meeting.progress} />
            ) : null}
            <DiarizationNotice
              canSeparate={
                detail.meeting.status === "ready" &&
                detail.speakers.every((speaker) => !speaker.originalLabel)
              }
              onSeparate={retry}
            />
            <Tabs className="min-h-0 flex-1" value={tab} onValueChange={setTab}>
              <TabsList variant="line">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="ask">Ask</TabsTrigger>
              </TabsList>
              <TabsContent value="summary" className="min-h-0 overflow-y-auto pt-6">
                <NotesPanel
                  key={`${detail.notes?.version ?? 0}-${detail.meeting.notesStatus}`}
                  detail={detail}
                  onChange={load}
                  onOpenSegment={openSegment}
                />
              </TabsContent>
              <TabsContent value="transcript" className="flex min-h-0 flex-col overflow-hidden pt-4">
                <TranscriptPanel
                  meetingId={meetingId}
                  segments={detail.segments}
                  speakers={detail.speakers}
                  audioMime={detail.meeting.audioMime}
                  focusId={focusId}
                  onChange={load}
                />
              </TabsContent>
              <TabsContent value="ask" className="flex min-h-0 flex-col overflow-hidden pt-4">
                <AskPanel
                  key={meetingId}
                  meetingId={meetingId}
                  storedMessages={detail.messages}
                  segments={detail.segments}
                  speakers={detail.speakers}
                  onOpenSegment={openSegment}
                />
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </main>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this meeting?</DialogTitle>
            <DialogDescription>
              The audio file, transcript, notes, and questions for this meeting are removed from this computer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep meeting
            </Button>
            <Button type="button" variant="destructive" onClick={remove}>
              Delete meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MeetingShell>
  );
}
