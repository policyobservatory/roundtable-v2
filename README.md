# Roundtable v2

A Cloudflare-native meeting analysis app deployed as a **Cloudflare Worker with static assets**.

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with [Tailwind CSS](https://tailwindcss.com/), built as a static SPA
- **Backend**: [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/)
- **Static assets**: [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **Object storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **AI transcript analysis**: GLM-5.3 Flash on Cloudflare Workers AI by default; OpenRouter and OpenAI-compatible LLM APIs remain available
- **Speech-to-text**: Deepgram Nova-3 or Whisper Large v3 Turbo on Cloudflare Workers AI, ElevenLabs, or Hugging Face
- **Related documents**: automatic per-card background searches via Cloudflare Queues and Policy Observatory’s `/v1/provisions` API; saved source links in both canvas views
- **Document chat**: uses the same Policy Observatory search adapter

## Transcript input

Paste a transcript or use **Upload a transcript** on the New Meeting screen.
Supported files are `.txt`, `.md`, `.srt`, and `.vtt`, encoded as UTF-8, up to **5 MB**.
Subtitle timestamps and speaker labels are preserved. PDF, Word, and audio files are not supported by this upload; export them to a supported text format first.

Files are read locally into the transcript editor, replacing its contents only after validation succeeds. Review or edit the text, then click **Map this meeting** to submit it for analysis. Invalid uploads leave the existing text unchanged.

Run upload validation tests with `npm test` (Node.js 24+).

## Configuring the model dropdown

Edit **`AI_MODELS` in `src/lib/constants.ts`** to control the options shown in transcript analysis, live meetings, and chat. Users select a friendly name instead of entering a provider or model ID. The first entry is the default: **GLM-5.3 Flash · Cloudflare** (`@cf/zai-org/glm-5.3-flash`). New transcript analysis and live maps use it unless another model is selected; existing meetings retain their saved provider/model. Cloudflare lists this model as requiring Workers Paid or supported prepaid AI Gateway access.

Curated Cloudflare text models use the existing `AI` binding without separate Cloudflare API credentials. Their responses are normalized across GLM’s `choices[0].message.content` and Llama’s `response` formats. `CF_ACCOUNT_ID` / `CF_API_TOKEN` are only needed for the legacy/custom-model REST fallback.

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

The **Deepgram Nova-3 · Cloudflare** speech option runs [`@cf/deepgram/nova-3`](https://developers.cloudflare.com/workers-ai/models/nova-3/) through the `AI` Workers AI binding configured in `wrangler.jsonc`. Audio chunks are streamed to the binding with their content type and smart formatting enabled. The existing `/api/stt/deepgram` route is retained, but it no longer calls Deepgram directly.

- No `DEEPGRAM_API_KEY` is required. Nova-3 also does not need `CF_ACCOUNT_ID` or `CF_API_TOKEN`; those are only needed for the legacy/custom-model text-analysis REST fallback, not the default GLM binding integration.
- `DEEPGRAM_STT_MODEL` is now `@cf/deepgram/nova-3`. Remove or update any local/dashboard override still set to `nova-2`.
- Deploy the updated Worker configuration to activate the `AI` binding. Workers AI usage is charged to your Cloudflare account.
- Local Nova-3 inference uses Cloudflare rather than an offline model, requires Wrangler authentication, and can incur usage charges. The automated STT tests mock the binding and make no inference calls.
- The speech model and conversation language selected on the New Meeting screen carry through to the live meeting.

**Whisper Large v3 Turbo · Cloudflare** is the default speech model. It runs [`@cf/openai/whisper-large-v3-turbo`](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) through the same `AI` binding via `/api/stt/whisper`, using batch transcription of recorded audio chunks. It needs no OpenAI or Hugging Face API key. The existing Hugging Face option remains separate.

### Filipino + English / Taglish

New meetings default to **Filipino + English (Taglish)** with Cloudflare Whisper. Configure presets/defaults in `shared/speech-settings.ts`.

- Whisper receives `task: 'transcribe'`, a Tagalog (`tl`) hint for the Taglish/Tagalog presets, voice activity detection, and `condition_on_previous_text: false` to reduce silent/repetitive hallucinations. No example transcript or generated translation is inserted.
- **English** sends `en`; **Auto-detect language** omits the Whisper language hint. Try Auto-detect if a mostly English recording performs worse with the Tagalog hint. Code-switching quality is not guaranteed by a single-language hint.
- Nova-3 supports explicit `en` / `tl` or dominant-language detection. Its [documented multilingual code-switching set](https://developers.deepgram.com/docs/models-languages-overview) does **not** include Tagalog, so it is not offered for the Taglish preset. Hugging Face/ElevenLabs remain available under Auto-detect; explicit hints for those adapters are not implemented.
- Live capture now uses approximately **12-second independent clips** rather than five seconds, providing more acoustic context at the cost of latency. Expect each clip plus inference time before text appears. This remains batch transcription, not real-time partial words; chunk boundaries can still split speech.
- `/api/stt/:provider?language=fil-en|tl|en|auto` validates presets and model compatibility. Omitting the query retains Auto-detect behavior for older clients.
- The tests verify request settings and preservation of returned mixed-language text, not actual recognition quality. Evaluate a representative consented Filipino/English recording before claiming an accuracy improvement. Existing bad transcriptions cannot be repaired by re-analyzing their text; they need correction or new transcription from the original audio.

## Automatic related documents

Cards automatically queue background searches without blocking transcription. Matching provision excerpts, bill status, and original-document links appear in either canvas view only when available. Otherwise the card stays unchanged: no loading badge, empty-result message, error banner, or retry prompt. Empty results are cached and are not retried. Accepted work survives leaving the page; saved meetings reuse persisted results.

**Setup:** this feature needs `migrations/0002_document_jobs.sql`, the `roundtable-v2-documents` queue, and `roundtable-v2-documents-dead`. See [background reference architecture, setup and recovery](docs/document-references.md).

No Policy Observatory API key is needed currently. `/v1/docs` is the Swagger documentation page; the adapter now correctly searches `/v1/provisions?query=…&limit=5`. **During implementation, that semantic-search endpoint returned HTTP 500 even though health/listing worked.** Temporary failures have bounded internal retries and remain silent in the meeting UI; the upstream issue must be resolved before real matches can be verified.

## Transcribing browser tab audio

1. On the main screen, click **Share browser tab audio** under **Start a live meeting**. The next screen will have **Browser tab audio** selected. Alternatively, choose **Use microphone**; you can still change the source in live-meeting setup.
2. Choose the conversation language and speech model. The Taglish preset selects Cloudflare Whisper; switch language presets to see other compatible providers.
3. Click **Share tab & start**. In the browser picker, select the tab playing the meeting and enable **Share tab audio**.
4. Keep that tab playing. The **live transcript and conversation graph** appear side by side. Recognized text is shown immediately with a Pending save/Saved label. After enough speech arrives, the graph updates roughly every 10 seconds with new topics, labeled connections, decisions, actions, and concerns.
5. Click **End meeting**, or use the browser's **Stop sharing** control. Roundtable finishes the last audio chunk and pending saves before final analysis. Review the map, then choose **Save & exit**.

Desktop Chrome or Edge over HTTPS is recommended; tab audio availability depends on browser and operating system. Selecting a window/screen or leaving audio sharing unchecked may provide no audio, in which case Roundtable explains how to retry. Cancelling the picker does not switch to microphone capture.

Only the shared audio track is recorded and sent to the speech provider. The browser also grants a video track for tab sharing, but Roundtable does not record or upload video. Microphone audio is **not mixed in**: to capture your microphone instead, choose **Microphone**. Let participants know before transcribing, and avoid sharing a tab that contains unrelated/private audio. Leaving the live meeting stops capture and discards audio that has not yet been submitted; use **End meeting** to finish and save normally. Recognized text is backed up in this browser until **Save & exit**; reopening Live Meeting offers recovery. When browser storage is blocked/full, a warning is shown. **Download transcript** works even if D1 is unavailable.

### Two canvas views

The toolbar offers **Live graph** and **Organized canvas** both during recording and in saved meetings:

- **Live graph:** one top-to-bottom lane in topic discovery order. Existing positions stay stable as topics arrive. While recording, **Follow newest topic** keeps new topics visible; panning or selecting a topic pauses following.
- **Organized canvas:** compact cards ranked by directed connections, with branches beside each other in at most three columns. Sequential chains still flow straight down rather than wrapping into a snake. Final review and saved meetings default to this layout.
- Both use the same map and preserve topic details, decisions, actions and concerns. Switching views does not call an AI model, rewrite the transcript, merge topics, or remove information. Dashed return arrows represent cycles/back-references rather than reversing the main flow.
- Saved graph views are snapshots, not a replay of historical live updates. Dense edges can still overlap; repeated topics across final-analysis chunks are not globally deduplicated.

### Save and analysis recovery

New live segments are written atomically to D1 with stable client-generated IDs. Transient connection/reset errors are retried with bounded backoff, and replaying a request cannot duplicate transcript text or inflate segment counts. Upload/paste transcripts remain in R2; new live text is assembled from ordered D1 segments. Legacy meetings continue reading their existing R2 transcript.

If saving or final analysis still fails, the recognized transcript stays visible. Use **Retry save & analyze**, or download a copy; failed saves are never labeled as saved. Speech recognition and live-map previews no longer run D1 schema statements. Preview failures do not stop recording. Unsaved raw audio and failed STT chunks cannot be recovered from the text draft.

See [the original-to-v2 feature comparison](docs/feature-parity.md) for restored behavior and remaining gaps.

## Local development

```bash
npm install

# Initialize the local schema once (DDL is no longer run on API requests)
npx wrangler d1 migrations apply roundtable-v2-db --local

# Terminal 1 — Hono API Worker (also serves dist assets once built)
npx wrangler dev

# Terminal 2 — SvelteKit dev server (calls /api routes proxied by Wrangler)
npm run dev
```

## Deploy

```bash
# Create the document queues once (skip if they already exist).
npx wrangler queues create roundtable-v2-documents
npx wrangler queues create roundtable-v2-documents-dead
# Apply all pending migrations, including 0002_document_jobs.sql, before deploying.
npx wrangler d1 migrations apply roundtable-v2-db --remote
npm run build
npx wrangler deploy --keep-vars
```

Or push to `main` with the included GitHub Actions workflow after adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repository secrets.

## Chunking & streaming strategy

Long transcripts are analyzed in ~6,000-character chunks. Each chunk result is saved to D1 as an `analysis_chunk` row and streamed to the client as a newline-delimited JSON event. The final map is aggregated from all chunks and stored on the `meetings` row. Uploaded transcripts and legacy live transcripts live in R2. New live meetings store independently retryable, ordered text segments in D1 and reconstruct the transcript when needed. Live previews are stateless, use up to 6,000 new characters plus the latest 40 topics as context, and merge into the client map; final analysis processes the complete saved transcript. Streaming event writes are awaited, and final-analysis retries replace existing per-part results instead of adding duplicates.

After deploying this update, reload open clients before starting new recordings: the segment API now requires a stable ID, index, and timestamp. Existing saved meetings remain readable.

`npm test` includes local D1/R2 integration tests using the installed Wrangler/Miniflare runtime. No production data or paid inference is used by those tests.
