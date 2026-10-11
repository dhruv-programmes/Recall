# Cursor Build Prompt — Local-First AI Meeting Notes (Next.js Web MVP)

You are the senior full-stack engineer working in this repository. Build a polished, demonstrable **Next.js website only** for a local-first AI meeting-notes app. This is a hiring assessment with a 1–2 day deadline.

## Product goal

Build a web app that lets a user upload an existing audio file or record an in-person meeting, transcribe English and Hindi speech, identify multiple speakers where possible, generate personalized notes, and ask questions about the meeting with answers grounded in the transcript.

**Optimize for a working end-to-end demo, maintainable code, and honest handling of model limitations. Do not over-engineer.**

## Scope: Next.js website only

- Build **only a Next.js web application** for this iteration.
- Do not create an Expo app, React Native app, React Native Web app, or mobile-specific workspace.
- Make the website responsive and usable on desktop and mobile browsers, using standard web UI components.
- We may build a React Native app later. Keep business logic and API contracts cleanly separated where practical, but do not implement or scaffold mobile support now.

## Required stack

- **Next.js App Router**
- **React and TypeScript**
- **pnpm only** for package management and scripts
- **Tailwind CSS**
- **shadcn/ui** for standard application components
- **Vercel AI Elements** for the AI conversation interface
- **Vercel AI SDK (`ai` package)** for AI SDK primitives, streaming, message handling, and model/provider integration
- **Python + FastAPI** for local speech processing
- **SQLite** for local meeting metadata, transcript segments, notes, and chat history
- **Ollama** for local LLM inference
- **faster-whisper** for local speech-to-text
- **pyannote.audio** for speaker diarization if installation and model access are feasible

Use current stable, mutually compatible versions. Inspect the existing repository first and preserve working conventions where possible. Do not use npm, Yarn, or Bun. Use `pnpm`, `pnpm dlx`, and `pnpm-lock.yaml`. Do not create a lockfile from another package manager.

## UI and design direction

Build a polished, calm, premium productivity SaaS interface inspired by Linear, Notion, and Granola:
- Neutral background, restrained accent color, subtle borders, generous spacing, excellent typography.
- Responsive desktop sidebar and mobile-browser navigation.
- Dashboard with recent meetings, search, and clear processing states.
- Prominent “Record meeting” and “Upload audio” actions.
- Meeting workspace with Summary, Transcript, and Ask AI views.
- Transcript segments with timestamps, speaker labels, search, edit affordances, and audio playback/jump-to-time where feasible.
- AI chat with streaming/loading states and visible citations to transcript segments.
- High-quality empty, loading, error, retry, and success states.
- Accessible controls, keyboard support, and responsive layouts.

Avoid gratuitous gradients, excessive glassmorphism, placeholder metrics, or fake activity. Make the interface feel complete but keep implementation lean.

## Mandatory: install and use Vercel AI Elements + AI SDK

Official resources:
- AI Elements announcement: https://vercel.com/changelog/introducing-ai-elements
- AI Elements documentation: https://elements.ai-sdk.dev/
- AI SDK documentation: https://ai-sdk.dev/docs/introduction

Before installing:
1. Inspect the current repository and package versions.
2. Read the latest official setup instructions for shadcn/ui, AI Elements, and AI SDK.
3. Verify current supported Next.js, React, Tailwind, and AI SDK compatibility.
4. Follow the official installation procedure. Do not guess registry URLs, component names, or CLI syntax.
5. Install shadcn/ui using its official setup instructions if it is not already installed.
6. Install AI Elements using its official current CLI/registry instructions. Add only the conversation, message, prompt-input, and other components needed for the MVP.
7. Install the Vercel AI SDK `ai` package and only provider packages required for local Ollama integration.
8. Verify the app builds and AI Elements components render in Next.js.
9. If an official setup step is incompatible with the repository, investigate the exact cause and document a justified workaround rather than silently skipping AI Elements.

Use shadcn/ui for navigation, cards, buttons, dialogs, forms, tabs, tooltips, and standard product UI. Use AI Elements for the meeting assistant/chat experience. Use the AI SDK for request handling, streaming, message handling, and model calls. Keep UI and model logic separate.

### Local model integration

The app must prioritize local inference and must not send audio or transcript contents to third-party AI APIs.

- Check the official AI SDK documentation for the current recommended way to connect to a locally running Ollama model. Use a supported provider/adapter and document setup.
- If a provider package is required, install it with pnpm.
- Configure base URL and model name through environment variables where appropriate.
- A typical Ollama server may be available at `http://127.0.0.1:11434`; check availability instead of assuming it.
- Never hard-code secrets or require a hosted model API key.
- If the AI SDK's supported Ollama route is unsuitable, isolate a direct local Ollama adapter behind a small interface, explain why, and still use AI SDK streaming/UI primitives wherever possible.

## Local-first architecture

All meeting audio, transcripts, notes, and LLM processing must remain local for this MVP.

Suggested structure:

```text
meeting-notes/
├── app/                         # Next.js App Router pages and route handlers
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── ai-elements/             # installed AI Elements components
│   ├── meetings/
│   ├── transcript/
│   └── notes/
├── lib/
│   ├── ai/                      # AI SDK and local model adapter
│   ├── api/
│   ├── schemas/
│   └── storage/
├── services/
│   └── speech/                  # Python FastAPI service
├── data/
│   └── audio/                   # ignored local audio files
├── README.md
└── pnpm-lock.yaml
```

Do not create a pnpm workspace unless it is useful for the existing repository. Keep the Python service independent of Node package management.

For this single-user assessment, do not introduce Kubernetes, cloud databases, cloud storage, hosted inference, billing, team collaboration, or unnecessary microservices.

## Speech and AI pipeline

Implement a sequential, observable pipeline:

1. Accept an uploaded or browser-recorded audio file.
2. Save the original file to a local application data directory and create a meeting record.
3. Create a processing status/job.
4. Run faster-whisper locally and preserve timestamps and detected language when available.
5. Attempt pyannote.audio diarization if setup and model access are available.
6. Align transcript segments with diarization intervals. If diarization fails, continue with an explicit unknown/generic speaker label that can be edited. Do not fail the entire meeting because diarization is unavailable.
7. Persist transcript segments with stable IDs, start/end time, text, speaker ID, language if available, and confidence only when genuinely provided by the model.
8. Generate structured notes using a local Ollama model via the Vercel AI SDK where supported.
9. Support questions against the selected meeting's transcript. Start with keyword/full-text retrieval if that's fastest and reliable. Add embeddings only after the basic workflow works.
10. Return answer citations pointing to actual transcript segment IDs and timestamps.

Do not fabricate confidence scores, speaker identities, owners, deadlines, or transcript evidence. Use null or clearly marked unknown values when information is missing. The LLM must say when the transcript does not contain enough information.

Configure model names and local service URLs through environment variables where practical. Detect missing dependencies/models and show actionable setup instructions. Do not assume a model is installed.

## API and processing design

Use Next.js route handlers for web application operations where appropriate, with Python handling speech inference.

Implement only the operations needed for:
- Create/list/get meetings.
- Upload an audio recording.
- Start processing and retrieve status.
- Fetch transcript segments.
- Rename speakers and edit transcript text.
- Generate/regenerate notes.
- Ask a question about a selected meeting.

Long-running inference should not block a normal web request until all stages finish. Return a processing ID/status and let the UI poll. For the one-user local MVP, a simple persisted job/status mechanism is sufficient; do not introduce a distributed queue.

Validate payloads and file types/sizes. Ensure audio paths are restricted to the app's data directory to prevent arbitrary file access. Handle failures and retries.

## Data model

Persist at least:
- Meeting: ID, title, created/started/ended timestamps, duration, status, audio path, language/settings, error if any.
- Speaker: ID, meeting ID, display name, original model label.
- Transcript segment: ID, meeting ID, speaker ID nullable, start/end time, text, language nullable, evidence metadata.
- Notes: meeting ID, structured content, created/updated timestamps, version if practical.
- Chat message: meeting ID, role, text, cited segment IDs, timestamp.

Use stable IDs. Store original audio outside the database and save local paths/keys. Ensure meetings can be reopened after restarting the app/services.

## Structured note schema

Generate structured content similar to:

```json
{
  "overview": "Short overview",
  "key_points": [
    {
      "text": "Point supported by the transcript",
      "evidence_segment_ids": ["segment-id"]
    }
  ],
  "decisions": [],
  "action_items": [
    {
      "task": "Task mentioned",
      "owner_speaker_id": null,
      "deadline": null,
      "evidence_segment_ids": []
    }
  ],
  "open_questions": []
}
```

Validate model output. If invalid JSON is returned, handle it gracefully and allow retry. Render notes as readable sections, not raw JSON. Let users edit notes without losing the source transcript.

## Recording requirements

Use the browser's supported MediaRecorder API for web recording, with microphone permission requests and clear recording status. Save/retain the recording before processing. Support upload via file picker. Handle unsupported browsers, denied permissions, interrupted recordings, and large files with useful errors.

Do not fake recording with a timer or generate mock transcripts as if they were real. If browser recording or a particular format fails, keep audio upload working and explain the limitation.

## Privacy and safety

- Do not send audio or transcripts to external AI services.
- Do not commit recordings, local database files, model files, or secrets.
- Add `.gitignore` entries for local data, audio, model artifacts, `.env`, and databases.
- Show clear recording/consent messaging.
- Validate upload type and size.
- Restrict file paths to the application's data directory.
- Avoid logging raw audio/transcript content by default.
- Make deletion of local meetings and recordings possible if time allows.
- Do not expose the local development API to the public internet.

## Development workflow

1. Inspect the repository before changing anything. Report framework, package manager, versions, and existing files.
2. Make a concise plan, then begin implementation without waiting for confirmation.
3. Search the web for current official documentation before installing/configuring shadcn/ui, AI Elements, AI SDK, Next.js, faster-whisper, pyannote.audio, and Ollama integration. Prefer official documentation and current compatibility information.
4. Use pnpm for every Node dependency, script, and package operation. Never switch package managers.
5. Validate local AI dependencies early. Test Ollama and faster-whisper with a short real audio file before spending too much time on UI polish.
6. Build the smallest real end-to-end flow first: upload audio → local transcription → persist transcript → local notes → grounded Q&A.
7. Install and integrate AI Elements and the Vercel AI SDK in the Next.js web app.
8. Add browser recording and polished UI without breaking the upload/transcription path.
9. Run type checking, linting, and available tests. Fix issues introduced by changes.
10. Test a real short audio file if one is available. Never claim tests passed unless actually run.
11. Update README with exact pnpm commands, Python environment setup, Ollama installation/model pull commands, environment variables, tested workflows, and known limitations.

## Acceptance criteria

The MVP is ready when:
- The Next.js website starts successfully using pnpm.
- shadcn/ui is installed and used for standard product UI.
- Vercel AI Elements is installed and used for the AI chat interface.
- Vercel AI SDK is used for model/streaming integration with a documented local Ollama path.
- A real audio file can be uploaded and saved locally.
- Browser recording works in the tested browser, or limitations are explained while upload still works.
- A local model produces a real English/Hindi transcript with timestamps.
- Speaker diarization works when configured, or the app degrades gracefully and lets users edit labels.
- Notes are generated from the saved transcript using the local LLM.
- Questions receive answers grounded in actual transcript passages with working source/timestamp links.
- Processing states and failures are visible.
- README lets another developer reproduce the tested workflow.
- No third-party hosted AI service receives meeting audio or transcript data.

## Final response after implementation

Summarize:
1. What you implemented.
2. Exact pnpm commands to run the Next.js website and speech service.
3. Which local models must be downloaded and their commands.
4. Which browser and workflows you actually tested.
5. Incomplete features and known limitations.
6. The next three highest-value tasks.

**Start by inspecting the repository and validating local AI dependencies. Build the smallest real end-to-end demo first. Use pnpm only. The deliverable for this iteration is a Next.js website, not a React Native app.**
