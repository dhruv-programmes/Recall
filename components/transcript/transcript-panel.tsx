"use client";

import { useEffect, useState } from "react";
import {
  Transcription,
  TranscriptionSegment,
} from "@/components/ai-elements/transcription";
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerSeekBackwardButton,
  AudioPlayerSeekForwardButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
  AudioPlayerVolumeRange,
} from "@/components/ai-elements/audio-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { formatTimestamp } from "@/lib/format";
import type { Segment, Speaker } from "@/lib/types";

export function TranscriptPanel({
  meetingId,
  segments,
  speakers,
  audioMime,
  focusId,
  onChange,
}: {
  meetingId: string;
  segments: Segment[];
  speakers: Speaker[];
  audioMime: string | null;
  focusId: string | null;
  onChange: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`segment-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);

  const speakerName = (id: string | null) =>
    speakers.find((speaker) => speaker.id === id)?.displayName ?? "Unknown";

  const visible = segments.filter((segment) => {
    const haystack = `${segment.text} ${speakerName(segment.speakerId)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  async function saveText(segment: Segment) {
    const text = draft.trim();
    if (!text || text === segment.text) {
      setEditing(null);
      return;
    }
    try {
      await api(`/api/meetings/${meetingId}/segments/${segment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
      setEditing(null);
      setError(null);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that line.");
    }
  }

  async function saveName(speakerId: string) {
    const displayName = names[speakerId]?.trim();
    const current = speakers.find((speaker) => speaker.id === speakerId)?.displayName;
    if (!displayName || displayName === current) return;
    try {
      await api(`/api/meetings/${meetingId}/speakers/${speakerId}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      setError(null);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename that speaker.");
    }
  }

  function seek(seconds: number) {
    const audio = document.querySelector<HTMLAudioElement>("[data-meeting-audio]");
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
    void audio.play().catch(() => undefined);
  }

  useEffect(() => {
    const audio = document.querySelector<HTMLAudioElement>("[data-meeting-audio]");
    if (!audio) return;
    const syncTime = () => setCurrentTime(audio.currentTime);
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("seeked", syncTime);
    return () => {
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("seeked", syncTime);
    };
  }, [audioMime, meetingId]);

  const lines = visible
    .filter((segment) => segment.text.trim())
    .map((segment) => ({
      id: segment.id,
      speakerId: segment.speakerId,
      text: segment.text,
      startMs: segment.startMs,
      startSecond: segment.startMs / 1000,
      endSecond:
        segment.endMs > segment.startMs
          ? segment.endMs / 1000
          : segment.startMs / 1000 + 0.05,
    }));
  const activeId =
    lines.find(
      (line) => currentTime >= line.startSecond && currentTime < line.endSecond,
    )?.id ?? null;
  useEffect(() => {
    if (!activeId || editing) return;
    document.getElementById(`segment-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, editing]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
      {audioMime ? (
        <AudioPlayer className="w-full max-w-3xl min-w-0 bg-transparent">
          <AudioPlayerElement
            data-meeting-audio
            preload="metadata"
            src={`/api/meetings/${meetingId}/audio`}
            aria-label="Meeting audio"
          />
          <AudioPlayerControlBar className="w-full">
            <AudioPlayerPlayButton />
            <AudioPlayerSeekBackwardButton seekOffset={10} />
            <AudioPlayerSeekForwardButton seekOffset={10} />
            <AudioPlayerTimeDisplay />
            <AudioPlayerTimeRange className="min-w-28 flex-1" />
            <AudioPlayerDurationDisplay />
            <AudioPlayerMuteButton />
            <AudioPlayerVolumeRange className="w-20" />
          </AudioPlayerControlBar>
        </AudioPlayer>
      ) : (
        <p className="text-sm text-muted-foreground">This meeting has no audio file.</p>
      )}
      </div>
      {segments.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          The transcript will show up here when speech processing finishes.
        </p>
      ) : null}
      {segments.length > 0 ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {speakers.map((speaker) => (
          <label key={speaker.id} className="flex items-center gap-2 text-sm">
            <span className="font-bold text-foreground">
              {speaker.originalLabel ?? "No model label"}
            </span>
            <Input
              aria-label={`Name for ${speaker.displayName}`}
              className="h-8 w-40"
              value={names[speaker.id] ?? speaker.displayName}
              onChange={(event) =>
                setNames((current) => ({ ...current, [speaker.id]: event.target.value }))
              }
              onBlur={() => saveName(speaker.id)}
            />
          </label>
        ))}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          name="transcript-search"
          autoComplete="off"
          placeholder="Search the transcript…"
          aria-label="Search the transcript"
          className="h-8 min-w-56 flex-1"
        />
      </div>
      {error ? (
        <p className="shrink-0 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lines match that search.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-card p-4">
        <Transcription
          className="grid w-full max-w-3xl min-w-0 gap-5"
          currentTime={currentTime}
          onSeek={seek}
          segments={lines}
        >
          {(segment, index) => {
            const line = lines[index];
            const source = segments.find((item) => item.id === line?.id);
            if (!line || !source) return null;
            return (
              <div className="grid w-full min-w-0 gap-1" id={`segment-${line.id}`}>
                <div className="flex items-baseline gap-3 text-sm text-muted-foreground">
                  <button
                    className="text-primary tabular-nums underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => seek(line.startSecond)}
                    type="button"
                  >
                    {formatTimestamp(line.startMs)}
                  </button>
                  <span>{speakerName(line.speakerId)}</span>
                </div>
                {editing === line.id ? (
                  <div className="grid gap-2">
                    <Textarea
                      aria-label="Transcript line"
                      onChange={(event) => setDraft(event.target.value)}
                      rows={3}
                      value={draft}
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => saveText(source)}>
                        Save line
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="min-w-0 text-base leading-7 break-words">
                    <TranscriptionSegment
                      className="inline text-left text-base leading-7 break-words whitespace-normal"
                      index={index}
                      segment={segment}
                    />{" "}
                    <button
                      className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => {
                        setEditing(line.id);
                        setDraft(line.text);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  </p>
                )}
              </div>
            );
          }}
        </Transcription>
        </div>
      )}
        </div>
      ) : null}
    </div>
  );
}
