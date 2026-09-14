# Roundtable v2

A Cloudflare-native meeting analysis app deployed as a **Cloudflare Worker with static assets**.

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with [Tailwind CSS](https://tailwindcss.com/), built as a static SPA
- **Backend**: [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/)
- **Static assets**: [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **Object storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **AI transcript analysis**: OpenRouter, Cloudflare Workers AI REST API, or any OpenAI-compatible LLM API
- **Speech-to-text**: Deepgram Nova-3 or Whisper Large v3 Turbo on Cloudflare Workers AI, ElevenLabs, or Hugging Face
- **Document chat**: references `api.policyobservatory.org/v1/docs`

## Transcript input

Paste a transcript or use **Upload a transcript** on the New Meeting screen.
Supported files are `.txt`, `.md`, `.srt`, and `.vtt`, encoded as UTF-8, up to **5 MB**.
Subtitle timestamps and speaker labels are preserved. PDF, Word, and audio files are not supported by this upload; export them to a supported text format first.

Files are read locally into the transcript editor, replacing its contents only after validation succeeds. Review or edit the text, then click **Map this meeting** to submit it for analysis. Invalid uploads leave the existing text unchanged.

Run upload validation tests with `npm test` (Node.js 24+).

## Configuring the model dropdown

Edit **`AI_MODELS` in `src/lib/constants.ts`** to control the options shown in transcript analysis, live meetings, and chat. Users select a friendly name instead of entering a provider or model ID. The first entry is the default.

To add an option, append an entry like this to the array, then rebuild/deploy:

```ts
{
  id: 'openrouter-gpt-4o', // Unique dropdown ID
  label: 'GPT-4o · OpenRouter',
  provider: 'openrouter', // 'openrouter', 'workers-ai', or 'llmapi'
  model: 'openai/gpt-4o', // Exact model ID sent to the provider
  description: 'For meetings that need more detailed analysis.'
}
```

Provider credentials must be configured separately. Remove entries for providers you do not offer. Chat defaults to the meeting's model when it is still listed, or the first configured option otherwise. This list controls the interface, not API authorization.

## Project structure

```
apps/api/src/index.ts   # Hono Worker with all API routes
shared/                 # Domain logic used by both Worker and frontend
src/                    # SvelteKit frontend
dist/                   # Built static frontend (gitignored)
wrangler.jsonc          # Worker, D1, R2, assets bindings
```

## Required secrets / bindings

Set these with Wrangler:

```bash
wrangler secret put OPENROUTER_API_KEY
wrangler secret put HF_TOKEN
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
# optional
wrangler secret put LLMAPI_URL
wrangler secret put LLMAPI_KEY
wrangler secret put POLICY_OBSERVATORY_API_KEY
```

Create D1 + R2 resources (already done for the initial deployment):

```bash
wrangler d1 create roundtable-v2-db
wrangler r2 bucket create roundtable-v2-transcripts
wrangler r2 bucket create roundtable-v2-audio
```

Paste the D1 database ID into `wrangler.jsonc` under `d1_databases.database_id`.

## Speech-to-text with Cloudflare Workers AI

The default speech option, **Deepgram Nova-3 · Cloudflare**, runs [`@cf/deepgram/nova-3`](https://developers.cloudflare.com/workers-ai/models/nova-3/) through the `AI` Workers AI binding configured in `wrangler.jsonc`. Audio chunks are streamed to the binding with their content type and smart formatting enabled. The existing `/api/stt/deepgram` route is retained, but it no longer calls Deepgram directly.

- No `DEEPGRAM_API_KEY` is required. Nova-3 also does not need `CF_ACCOUNT_ID` or `CF_API_TOKEN`; those remain necessary only for the existing Workers AI **text analysis REST integration**.
- `DEEPGRAM_STT_MODEL` is now `@cf/deepgram/nova-3`. Remove or update any local/dashboard override still set to `nova-2`.
- Deploy the updated Worker configuration to activate the `AI` binding. Workers AI usage is charged to your Cloudflare account.
- Local Nova-3 inference uses Cloudflare rather than an offline model, requires Wrangler authentication, and can incur usage charges. The automated STT tests mock the binding and make no inference calls.
- The speech option selected on the New Meeting screen carries through to the live meeting.

**Whisper Large v3 Turbo · Cloudflare** is also available in both speech dropdowns. It runs [`@cf/openai/whisper-large-v3-turbo`](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) through the same `AI` binding via `/api/stt/whisper`, using batch transcription of recorded audio chunks. It needs no OpenAI or Hugging Face API key. The existing Hugging Face option remains separate. Deepgram Nova-3 remains the default.

## Transcribing browser tab audio

1. Open **Start Live Meeting** and select **Browser tab audio** under **Audio source**.
2. Choose a speech model (Cloudflare Nova-3, Cloudflare Whisper, or another configured provider).
3. Click **Share tab & start**. In the browser picker, select the tab playing the meeting and enable **Share tab audio**.
4. Keep that tab playing. Transcript segments appear as they are transcribed and saved.
5. Click **Stop & analyze**, or use the browser's **Stop sharing** control. Roundtable finishes the last audio chunk and pending transcriptions before starting analysis.

Desktop Chrome or Edge over HTTPS is recommended; tab audio availability depends on browser and operating system. Selecting a window/screen or leaving audio sharing unchecked may provide no audio, in which case Roundtable explains how to retry. Cancelling the picker does not switch to microphone capture.

Only the shared audio track is recorded and sent to the speech provider. The browser also grants a video track for tab sharing, but Roundtable does not record or upload video. Microphone audio is **not mixed in**: to capture your microphone instead, choose **Microphone**. Let participants know before transcribing, and avoid sharing a tab that contains unrelated/private audio. Leaving the live meeting stops capture and discards audio that has not yet been submitted; use **Stop & analyze** to finish and save normally.

## Local development

```bash
npm install

# Terminal 1 — Hono API Worker (also serves dist assets once built)
npx wrangler dev

# Terminal 2 — SvelteKit dev server (calls /api routes proxied by Wrangler)
npm run dev
```

## Deploy

```bash
npm run build
npx wrangler deploy
```

Or push to `main` with the included GitHub Actions workflow after adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repository secrets.

## Chunking & streaming strategy

Long transcripts are analyzed in ~6,000-character chunks. Each chunk result is saved to D1 as an `analysis_chunk` row and streamed to the client as a newline-delimited JSON event. The final map is aggregated from all chunks and stored on the `meetings` row. Transcripts themselves live in R2, so D1 row sizes stay small.
