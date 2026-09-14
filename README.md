# Roundtable v2

A Cloudflare-native meeting analysis app.

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with [Tailwind CSS](https://tailwindcss.com/)
- **Backend**: [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/) / Workers
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **Object storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **AI transcript analysis**: OpenRouter, Cloudflare Workers AI, or any OpenAI-compatible LLM API
- **Speech-to-text**: Deepgram, ElevenLabs, or Hugging Face
- **Document chat**: references `api.policyobservatory.org/v1/docs`

## Project structure

```
src/
  lib/
    ai.ts              # AI provider abstraction
    stt.ts             # STT provider abstraction
    db.ts              # D1 access layer & migrations
    storage.ts         # R2 helpers
    docs.ts            # Policy Observatory document API client
    analysis.ts        # Chunked transcript analysis
    platform.ts        # Cloudflare platform env helpers
  routes/
    api/               # API routes (run on Workers)
    +page.svelte       # Main app
```

## Required secrets / bindings

Set these with Wrangler:

```bash
wrangler secret put OPENROUTER_API_KEY
wrangler secret put HF_TOKEN
wrangler secret put DEEPGRAM_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put LLMAPI_URL     # optional
wrangler secret put LLMAPI_KEY       # optional
wrangler secret put POLICY_OBSERVATORY_API_KEY  # optional
```

Create D1 + R2 resources:

```bash
wrangler d1 create roundtable-v2-db
wrangler r2 bucket create roundtable-v2-transcripts
wrangler r2 bucket create roundtable-v2-audio
```

Paste the D1 database ID into `wrangler.jsonc` under `d1_databases.database_id`.

## Local development

```bash
npm install
npm run dev              # plain Vite dev (API routes won't have Cloudflare bindings)
npm run preview          # full Cloudflare Pages Functions with local D1/R2
```

For `preview`, bindings are created locally on first run. The schema is auto-created at runtime.

## Deploy

```bash
npm run build
wrangler pages deploy
```

Or push to `main` with the included GitHub Actions workflow after adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repository secrets.

## Chunking & streaming strategy

Long transcripts are analyzed in ~6,000-character chunks. Each chunk result is saved to D1 as an `analysis_chunk` row and streamed to the client as a newline-delimited JSON event. The final map is aggregated from all chunks and stored on the `meetings` row. Transcripts themselves live in R2, so D1 row sizes stay small.
