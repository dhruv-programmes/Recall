# Recall

Record a meeting in the browser. Sarvam writes the transcript and speaker labels. Notes and questions use OpenRouter.

## What you need

- Node.js 22 or newer
- pnpm 10
- An OpenRouter API key
- A Sarvam API key from the [Sarvam dashboard](https://dashboard.sarvam.ai/)
- A Supabase project with anonymous sign-in enabled

## Setup

From the repo root:

```bash
pnpm install
copy .env.example .env
```

On macOS or Linux, use `cp .env.example .env`. Fill in the keys, then restart the app.

## Run

```bash
pnpm dev
```

Open http://localhost:3000. Production mode is `pnpm build` then `pnpm start`.

On Vercel, set these environment variables before the first deploy:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SARVAM_API_KEY`
- `OPENROUTER_API_KEY`

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | unset | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | unset | Browser and server key. Not a secret key |
| `OPENROUTER_API_KEY` | unset | Notes and questions. Wins over `OPENAI_API_KEY` |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | OpenRouter model id |
| `OPENAI_API_KEY` | unset | Optional fallback. Calls `gpt-4o-mini` on OpenAI when OpenRouter is unset |
| `SARVAM_API_KEY` | unset | Sarvam batch transcription and speaker labels |
| `MAX_UPLOAD_BYTES` | `209715200` | Upload limit, 200 MB |

The Next.js app reads `.env`. Do not commit it.

## How a meeting is processed

1. The browser records audio, or you choose a file. The file is uploaded straight to a private Supabase Storage bucket.
2. Next.js creates the meeting for the signed-in anonymous user, then sends that audio to a Sarvam batch job.
3. The page polls until Sarvam finishes. Progress is stored on the meeting row.
4. Diarized lines, timestamps, and detected language are saved in Postgres. Speaker names stay editable.
5. Notes are generated with the Vercel AI SDK through OpenRouter. Questions stream from the same model and cite real transcript lines.

Each browser only sees its own meetings. Clearing site data starts a new empty account.
