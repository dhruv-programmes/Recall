export type MeetingStatus = "recording" | "queued" | "transcribing" | "ready" | "failed";
export type ProgressPhase = "queued" | "loading" | "transcribing" | "diarizing" | "notes";

export type MeetingProgress = {
  phase: ProgressPhase;
  ratio: number | null;
  processedSeconds: number | null;
  durationSeconds: number | null;
};
export type NotesStatus = "empty" | "generating" | "ready" | "failed";
export type MeetingSource = "upload" | "recording";

export type Meeting = {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: MeetingStatus;
  audioMime: string | null;
  language: string | null;
  error: string | null;
  source: MeetingSource;
  diarizationNote: string | null;
  notesStatus: NotesStatus;
  notesError: string | null;
  progress: MeetingProgress | null;
};

export type Speaker = {
  id: string;
  meetingId: string;
  displayName: string;
  originalLabel: string | null;
};

export type Segment = {
  id: string;
  meetingId: string;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
};

export type NoteItem = {
  text: string;
  evidence_segment_ids: string[];
};

export type ActionItem = {
  task: string;
  owner_speaker_id: string | null;
  deadline: string | null;
  evidence_segment_ids: string[];
};

export type NotesContent = {
  overview: string;
  key_points: NoteItem[];
  decisions: NoteItem[];
  action_items: ActionItem[];
  open_questions: NoteItem[];
};

export type NotesRecord = {
  id: string;
  meetingId: string;
  content: NotesContent;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ChatMessageRecord = {
  id: string;
  meetingId: string;
  role: "user" | "assistant";
  text: string;
  citedSegmentIds: string[];
  createdAt: string;
};

export type MeetingDetail = {
  meeting: Meeting;
  speakers: Speaker[];
  segments: Segment[];
  notes: NotesRecord | null;
  messages: ChatMessageRecord[];
};

export type HealthReport = {
  model: { ok: boolean; model: string; detail: string };
  speech: { ok: boolean; detail: string };
};
