"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Persona, type PersonaState } from "@/components/ai-elements/persona";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/client";
import type { MeetingDetail } from "@/lib/types";

function supportedMime() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
}

export function RecordPanel() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(
      Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined",
    );
  }, []);

  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== "recording") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const blockLinks = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (window.confirm("This recording has not been saved. Leave anyway?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", blockLinks, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", blockLinks, true);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function resetCapture() {
    recorder.current = null;
    chunks.current = [];
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  async function start() {
    setError(null);
    if (!supported) {
      setError("This browser cannot record audio. Upload a file instead.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mime = supportedMime();
      const mediaRecorder = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      mediaRecorder.start();
      recorder.current = mediaRecorder;
      setSeconds(0);
      setStatus("recording");
    } catch (caught) {
      const denied =
        caught instanceof DOMException &&
        (caught.name === "NotAllowedError" || caught.name === "SecurityError");
      setError(
        denied
          ? "Microphone access was denied. You can upload an audio file instead."
          : "Recording could not start. Upload an audio file instead.",
      );
    }
  }

  async function stopAndSave() {
    const mediaRecorder = recorder.current;
    if (!mediaRecorder) return;
    setStatus("saving");
    const blob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" }));
      };
      mediaRecorder.stop();
    });
    resetCapture();
    if (blob.size === 0) {
      setStatus("idle");
      setError("The recording was empty. Try again or upload a file.");
      return;
    }
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `recording.${extension}`, { type: blob.type });
      const body = new FormData();
      body.set("file", file);
      body.set("source", "recording");
      if (title.trim()) body.set("title", title.trim());
      const detail = await api<MeetingDetail>("/api/meetings", {
        method: "POST",
        body,
      });
      setStatus("idle");
      setTitle("");
      router.push(`/meetings/${detail.meeting.id}`);
      toast.success("Recording saved. Transcription is running.");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof ApiError ? caught.message : "Could not save the recording.");
    }
  }

  const clock = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  const personaState: PersonaState =
    status === "recording" ? "listening" : status === "saving" ? "thinking" : "idle";
  const statusText =
    status === "recording" ? `Recording ${clock}` : status === "saving" ? "Saving the recording." : null;

  return (
    <div className="reading grid gap-8">
      <div className="grid gap-3">
        <h1 className="text-4xl leading-tight font-semibold">Meeting notes</h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Record the room from here. The transcript is written after you save.
        </p>
      </div>
      <div className="grid gap-6 rounded-xl border border-border bg-card px-5 py-6">
        <div className="flex flex-col items-center gap-3">
          <div className="size-32 shrink-0 overflow-hidden md:size-40" aria-hidden="true">
            <Persona className="size-full" state={personaState} variant="opal" />
          </div>
          {statusText ? (
            <p className="text-sm tabular-nums" aria-live="polite">
              {statusText}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="record-title">Title</Label>
          <Input
            id="record-title"
            name="title"
            autoComplete="off"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional…"
            disabled={status !== "idle"}
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            This browser cannot record from the microphone. Upload an audio file instead.
          </p>
        ) : null}
        {status === "recording" ? (
          <Button type="button" onClick={stopAndSave} className="w-fit">
            Stop and save
          </Button>
        ) : (
          <Button type="button" onClick={start} disabled={status === "saving" || !supported} className="w-fit">
            {status === "saving" ? "Saving…" : "Start recording"}
          </Button>
        )}
      </div>
    </div>
  );
}
