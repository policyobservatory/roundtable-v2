# Background document references

## Data flow

1. A card appears/changes. After a two-second debounce, the browser submits its ID, title and summary to `POST /api/meetings/:id/references` (at most 20 cards per request).
2. The Worker hashes the normalized title/summary and inserts a content-addressed D1 job. Identical content reuses a job **within that meeting**, even if final analysis assigns a different card ID.
3. The Worker sends `{ jobId, generation }` to `roundtable-v2-documents`. The message contains no audio or transcript; the consumer reads the short query from D1.
4. The queue consumer claims a D1 lease, calls Policy Observatory, saves references, then acknowledges delivery. Transcription and live-map preview do not call or await this consumer.
5. The browser polls status every three seconds only while current cards have pending work. Both canvas layouts show reference links/counts only when usable matches exist; opening a matched card shows excerpts and source links. Pending, empty, failed, and unlinkable results show nothing, with no retry prompts. Final analysis also schedules its final-card jobs server-side with `waitUntil`; reopening a saved meeting ensures any missing jobs exist.

Accepted jobs can finish after the browser closes. Cards still waiting for the browser debounce/request have not been accepted yet. Closing during final analysis can still interrupt that existing analysis pipeline; the queue does not make final AI analysis itself durable.

## Verified Policy Observatory contract

- OpenAPI: `https://api.policyobservatory.org/v1/openapi.json`
- Search: `GET /v1/provisions?query=<up to 500 characters>&limit=5`
- Records use an `items` array with `meta.section_id`, `meta.bill_id`, `meta.section_title`, and `body`.
- Optional bill metadata: `GET /v1/bills/:bill_id`. The adapter uses `text_as_filed` for original-document links, plus the bill title/status. Failure of this optional lookup does not discard valid provisions.
- **`/v1/docs` is Swagger HTML, not document search.** The old URL setting is normalized for backwards compatibility. `POLICY_OBSERVATORY_DOCS_URL` now points to the API base `/v1`.
- No authentication is required in the current deployment. If enabled later, the optional `POLICY_OBSERVATORY_API_KEY` is sent as **`X-API-Key`**, as documented by OpenAPI, not a Bearer token.

During implementation on 2026-09-14, health and unfiltered provision listing worked without authentication, but provision queries such as `query=data privacy` returned **HTTP 500**. This is an upstream search failure, not an empty result. The adapter records this accurately for diagnostics while the card UI stays quiet; inspect Policy Observatory server logs/semantic-search dependencies to resolve it. No successful live semantic-search result has been claimed. Tests use response fixtures based on the available API records.

The API describes semantic search in plain English. Queries are the card title/summary, capped at 500 characters; there is no extra translation or RAG-answer generation step. Mixed-language retrieval quality still needs evaluation. Excerpts are limited to 2,000 characters per provision. Retrieved matches are candidates, not proof of relevance or enacted law.

## Reliability and recovery

`migrations/0002_document_jobs.sql` adds `document_jobs`, separate from `meetings.map`. Document writes cannot overwrite a newer graph or transcript.

States: `pending` (durable outbox), `queued`, `searching`, `ready`, `empty`, `error`.

- The outbox is committed **before** sending. A failed or ambiguous send leaves recoverable work, rather than losing it or reporting false search success.
- A one-minute Cron Trigger republishes due outbox work and recovers expired processing leases. It dispatches at most 20 jobs per invocation. Publication uses a short atomic dispatch lease; a confirmed queue send is not swept again for ten minutes if still waiting.
- Consumers have a two-minute processing lease and token-guarded writes. Duplicate delivery cannot concurrently own the same job. A crash can cause the read-only external search to run again after lease expiry, but results are stored idempotently.
- Up to four processing attempts use delayed retries (15, 30, 60 seconds). Permanent errors stop immediately; exhausted jobs remain failed internally without a UI prompt. Empty results are terminal and are never retried. Storage/transport errors also have queue-level retries and a dead-letter queue. The D1 outbox remains the recovery source if queue delivery is exhausted.
- An explicit maintenance/API retry of a failed job increments the generation; there is no card retry button. Messages/responses from older generations cannot overwrite the retry. Results for old card content are kept separately and are not shown on changed cards.
- Deleting a meeting cascades to its jobs; queued messages cannot recreate deleted records.
- Polling/submission failures back off silently for 30 seconds. Leaving the screen aborts browser requests and polling, not accepted server jobs.

This does not provide exactly-once external API calls. A crash between the search and its saved result can repeat a search. Do not purge queues expecting that to cancel jobs: the scheduled outbox can republish them.

## Deployment

No new API key is necessary. Create these queues once in the same Cloudflare account as `roundtable-v2`:

```sh
npx wrangler queues create roundtable-v2-documents
npx wrangler queues create roundtable-v2-documents-dead
npx wrangler d1 migrations apply roundtable-v2-db --remote
npm run build
npx wrangler deploy --keep-vars
```

The checked-in `wrangler.jsonc` includes the producer, consumer (one job per batch, up to three concurrent consumers), dead-letter queue, and recovery Cron Trigger. This modest concurrency bound prevents bursts; it is not application authentication or a rate-limit system. Apply the migration before deploying. Reload old browser tabs after deployment.

Local development:

```sh
npx wrangler d1 migrations apply roundtable-v2-db --local
npm run build
npx wrangler dev
```

Wrangler simulates the queue locally, but the external Policy Observatory HTTP calls are still real. Automated tests mock that service and make no inference calls.

## Validation

`npm test` includes adapter contract/response-limit tests, real local D1 tests with simulated queue deliveries (duplicate/ambiguous delivery, crash recovery, stale generations, deletion, final-analysis scheduling), and frontend controller tests. No remote inference is used.

`npm run test:browser` builds the app and runs an optional headless Chromium smoke test against a local mocked API. On Windows it defaults to installed Edge; set `BROWSER_PATH` for another Chromium executable. It checks that pending/failed/empty results stay invisible, matched documents have working link markup, switching views does not repeat empty searches, both layouts, the existing tab-audio setup selection, and browser runtime exceptions. It also covers the asynchronously loaded Past Meetings list. This is **not** a real audio-capture or live Policy Observatory search test.

## Privacy and remaining limits

- Policy Observatory receives topic search queries, not full transcripts or audio. Bill lookups send only bill IDs. Queries and retrieved excerpts are stored in D1 until the meeting is deleted; queue messages contain only job identifiers.
- There is no authentication/authorization or user quota on Roundtable's API yet. Before opening it to untrusted users, add meeting-scoped access checks and abuse/cost controls. This implementation intentionally does not require a Policy Observatory credential.
- Results are cached per content revision for the lifetime of the meeting, without cross-meeting sharing or automatic corpus-version invalidation. The UI displays their last update time.
- Retrieval errors are not treated as empty matches. The existing chat endpoint remains best-effort if its document lookup fails; card searches retain status/errors internally but display only successful, linkable matches.
- Browser permission/audio capture and real mixed-language recognition accuracy remain separate manual checks.
