"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/client";
import type { MeetingDetail } from "@/lib/types";

export function UploadDialog({
  onCreated,
}: {
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) {
      toast.error("Choose an audio file.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("source", "upload");
      if (title.trim()) body.set("title", title.trim());
      const detail = await api<MeetingDetail>("/api/meetings", {
        method: "POST",
        body,
      });
      setOpen(false);
      setFile(null);
      setTitle("");
      onCreated?.(detail.meeting.id);
      router.push(`/meetings/${detail.meeting.id}`);
      toast.success("Audio saved. Transcription is running locally.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Upload audio
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload audio</DialogTitle>
          <DialogDescription>
            The file stays in this app&apos;s local data folder. mp3, wav, m4a, webm, and ogg are accepted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="audio-file">Audio file</Label>
            <Input
              id="audio-file"
              type="file"
              accept="audio/*,video/webm,.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="upload-title">Title</Label>
            <Input
              id="upload-title"
              name="title"
              autoComplete="off"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save and transcribe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
