# Meeting notes

Meeting notes for one person. Upload or record audio in the browser. Sarvam transcribes it and labels speakers. Notes and questions use OpenRouter.

## What you need

- Node.js 22 or newer
- pnpm 10
- An OpenRouter API key
- A Sarvam API key from the [Sarvam dashboard](https://dashboard.sarvam.ai/)

## Setup

From the repo root:

```bash
pnpm install
copy .env.example .env
```

On macOS or Linux, use `cp .env.example .env`. Put your Sarvam key in `SARVAM_API_KEY` and your OpenRouter key in `OPENROUTER_API_KEY`, then restart the app.

## Run

```bash
pnpm dev
```

Open http://localhost:3000. Production mode is `pnpm build` then `pnpm start`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Notes and questions. Wins over `OPENAI_API_KEY` |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | OpenRouter model id |
| `OPENAI_API_KEY` | unset | Optional fallback. Calls `gpt-4o-mini` on OpenAI when OpenRouter is unset |
| `SARVAM_API_KEY` | unset | Sarvam batch transcription and speaker labels |
| `DATA_DIR` | `./data` | SQLite database and audio |
| `MAX_UPLOAD_BYTES` | `209715200` | Upload limit, 200 MB |

The Next.js app reads `.env`.

## How a meeting is processed

1. The browser uploads a file, or records one with `MediaRecorder` and uploads that blob.
2. The audio is stored under `data/audio`. Paths outside `DATA_DIR` are rejected.
3. Next.js uploads that audio to a Sarvam batch job (Saaras v4, auto-detected language, speaker diarization) and returns immediately.
4. The page polls `GET /api/meetings/[id]` until Sarvam finishes. The bar stays indeterminate because Sarvam does not report audio seconds completed.
5. Diarized lines, timestamps, and detected language are saved in SQLite. Speaker names stay editable.
6. Notes are generated with the Vercel AI SDK through OpenRouter (`openai/gpt-4o-mini`). Invalid model output can be retried. The transcript is not sent to Sarvam for this step.
7. Questions stream from OpenRouter. The first step must search the saved transcript, then the model may make up to 6 steps and is asked to use 1–3 tool calls. Citations point at real segment ids.

## Stack notes

- Package manager is pnpm only. The lockfile is `pnpm-lock.yaml`.
- Chat UI uses Vercel AI Elements: conversation, message, prompt-input, inline citation, sources, and shimmer. The current registry has no `loader` or `source` item; shimmer and sources cover those roles.
- Model calls use `ai` (`streamText`, `generateText`, `Output.object`) and `@ai-sdk/react` (`useChat`). The adapter is `@ai-sdk/openai` pointed at OpenRouter.
- Libre Caslon Condensed is the only typeface. `next/font/google` in Next.js 16.4 lists Libre Caslon Text and Libre Caslon Display, not the condensed cut, so the app loads the OFL files with `next/font/local` from `@fontsource/libre-caslon-condensed`.
- Transcription uses the `sarvamai` SDK against Sarvam's batch speech-to-text API. The short REST endpoint does not return speakers.

## What was tested

On this Windows machine:

- Earlier meetings were transcribed locally. New meetings are transcribed by Sarvam.
- Uploading that file to `POST /api/meetings` saved it, polled to `ready`, and wrote structured notes, including evidence segment ids.
- `POST /api/meetings/[id]/chat` streamed an answer that cited a real segment.
- `pnpm typecheck` and `pnpm lint` were run after the last code changes.
- Page HTML was requested with curl. No browser window was opened in the last pass, so microphone recording, tab clicks, and citation jumps were not exercised in a browser. Recording still depends on `MediaRecorder` and permission prompts in the browser you use.

## Limits

- No embeddings. Questions use keyword search, then the rest of a short transcript when search finds nothing.
- Speaker labels come from Sarvam diarization. The speaker count is estimated. Names start as Speaker 1 and Speaker 2 until you edit them.
- Notes and transcription assume the Next.js server process stays running. There is no separate queue.
- Sarvam batch jobs accept up to about two hours of audio. This app still rejects uploads over `MAX_UPLOAD_BYTES`.
- Meeting audio is uploaded to Sarvam. Notes and questions are sent to OpenRouter.
