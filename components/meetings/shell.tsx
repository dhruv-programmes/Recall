"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ProcessingProgress } from "@/components/meetings/processing-progress";
import { UploadDialog } from "@/components/meetings/upload-dialog";
import { api } from "@/lib/client";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, progressLabel, progressPercent, statusLabel } from "@/lib/format";
import type { HealthReport, Meeting } from "@/lib/types";

export function MeetingShell({
  activeId,
  children,
}: {
  activeId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);
  const statusKey = meetings.map((meeting) => `${meeting.id}:${meeting.status}`).join();
  const processing = meetings.some((meeting) => meeting.progress);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (cancelled) return;
        if (error) {
          setListError(error.message);
          return;
        }
      }
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const handle = window.setTimeout(() => {
      api<{ meetings: Meeting[] }>(`/api/meetings?q=${encodeURIComponent(query)}`)
        .then((data) => {
          setMeetings(data.meetings);
          setListError(null);
        })
        .catch((error: Error) => setListError(error.message));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [sessionReady, query, activeId, statusKey, tick]);

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 2000);
    return () => window.clearInterval(timer);
  }, [processing]);

  useEffect(() => {
    api<HealthReport>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const list = (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="px-4 pt-5 pb-3">
        <p className="text-lg leading-none font-semibold">Meetings</p>
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className={`-mx-2 mt-4 block rounded-md px-2 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
            pathname === "/" ? "bg-muted font-medium" : "hover:bg-muted/70"
          }`}
        >
          Record
        </Link>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          name="q"
          autoComplete="off"
          placeholder="Search titles…"
          aria-label="Search meetings"
          className="mt-3"
        />
      </div>
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-4">
        {listError ? (
          <p className="px-2 text-sm text-destructive" role="alert">
            {listError}
          </p>
        ) : meetings.length === 0 ? (
          <p className="px-2 text-sm leading-6 text-muted-foreground">
            {query ? "No titles match that search." : "No meetings yet."}
          </p>
        ) : (
          <ul className="grid min-w-0 gap-1">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="min-w-0">
                <Link
                  href={`/meetings/${meeting.id}`}
                  title={meeting.title}
                  className={`block min-w-0 overflow-hidden rounded-md px-2 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    meeting.id === activeId ? "bg-muted" : "hover:bg-muted/70"
                  }`}
                >
                  <span className="block truncate font-medium">{meeting.title}</span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {meeting.progress
                      ? progressLabel(meeting.progress)
                      : statusLabel(meeting.status)}
                    {meeting.progress && progressPercent(meeting.progress) != null
                      ? ` ${progressPercent(meeting.progress)}%`
                      : ""}
                    {formatDuration(meeting.durationMs)
                      ? `, ${formatDuration(meeting.durationMs)}`
                      : ""}
                  </span>
                  {meeting.progress ? (
                    <ProcessingProgress progress={meeting.progress} compact />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-svh min-w-0 overflow-hidden bg-background">
      <aside className="hidden h-full w-72 shrink-0 overflow-hidden border-r border-border bg-card md:flex">
        {list}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger
                render={<Button variant="outline" size="icon" className="md:hidden" />}
              >
                <Menu aria-hidden="true" />
                <span className="sr-only">Open meetings</span>
              </SheetTrigger>
              <SheetContent side="left" className="p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Meetings</SheetTitle>
                </SheetHeader>
                {list}
              </SheetContent>
            </Sheet>
            <p className="text-sm text-muted-foreground md:hidden">Meetings</p>
          </div>
          <div className="flex items-center gap-2">
            <UploadDialog />
            {pathname === "/" ? null : (
              <Link href="/" className={buttonVariants()}>
                Record meeting
              </Link>
            )}
          </div>
        </header>
        {health && (!health.model.ok || !health.speech.ok) ? (
          <div className="shrink-0 border-b border-border bg-card px-4 py-3 text-sm leading-6 md:px-8">
            {!health.speech.ok ? <p>{health.speech.detail}</p> : null}
            {!health.model.ok ? <p>{health.model.detail}</p> : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {sessionReady ? (
            children
          ) : (
            <p className="px-8 py-8 text-sm text-muted-foreground">
              {listError ? listError : "Signing in…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
