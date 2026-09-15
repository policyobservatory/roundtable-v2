# Original → v2 feature comparison

This is a source-level comparison, not a claim that every original feature has been ported or every browser/provider has been tested end to end.

## Findings

| Capability | `roundtable-original` | v2 before this update | v2 with this update |
| --- | --- | --- | --- |
| Transcript beside a live canvas | Yes, 30% transcript / remaining graph | No; setup card and transcript list, then post-meeting list | Restored split view; stacks vertically on small screens |
| Progressive topic analysis | ~10s, first 100 / subsequent 150 new characters | None during recording | Restored thresholds and cadence, one request at a time; incremental text and bounded recent-topic context |
| Directed, labeled topic graph | SVG links, multi-column card layout | Indented hierarchy; edges ignored | Switchable downward live graph and compact top-to-bottom organized canvas; directed/labeled links retained |
| Pan, zoom, fit and topic navigation | Yes | None | Drag/keyboard pan, zoom buttons, fit, topic-navigation strip |
| Decisions / actions / concerns | Structured arrays with detail sections | Summary strings only | Structured arrays in new analyses; selectable topic details |
| Per-node change history | Timestamped updates and summary-change indicators | No | **Not yet ported** |
| Clarifying questions | Separate periodically refreshed panel | No | **Not yet ported** |
| Per-topic document references | Automatic queries, source links and match indicators | Only document-grounded chat | Background per-card searches with direct document lists in both layouts, persisted excerpts/source links, visible lookup states and explicit failed-search retry; no generated reference answer or confidence score |
| Transcript auto-follow | Yes | No | Restored; pauses when scrolling up |
| Speaker labels and partial transcripts | ElevenLabs realtime path provides these; batch Whisper does not | Batch text only | **Still batch text only**; timestamps are not speaker diarization |
| Microphone / tab audio | Microphone plus Hugging Face tab path | Both sources supported through all STT choices | Retained; one capture grant, audio-only recorder, cleanup on leave |
| Recording timer and status | Yes | Basic status only | Timer, source/model, pending/saved counts, independent preview errors |
| End → review → Save & Exit | Yes | Immediately navigates on success | Restored review step, correct transcript passed to saved canvas |
| Crash recovery | Browser autosave of segments + map | None | Recognized text, save state and meeting/model IDs backed up locally; restore on opening Live Meeting; map is recomputed |
| Safe retry after save failure | Local recovery available | Text shown only after save; generic fatal stop message | Text displayed first, idempotent D1 saves, retry/download controls |
| Retry an older failed analysis | Recovery workflow | No explicit button | Retry analysis from a saved, incomplete meeting |
| Model selection | Provider choice, including switching during recording | Editable model field, subsequently replaced by curated dropdown | Curated model list retained; selection stays locked during a live session |
| Paste / upload transcripts | Paste | Paste + validated file upload | Retained |
| Persistent meeting history | API-backed saves | D1 + R2 | Retained with legacy transcript compatibility |

## Evidence reviewed

Original:
- `src/components/LiveMeetingView.tsx`
- `src/components/LiveTranscriptPanel.tsx`
- `src/components/CanvasView.tsx`
- `src/hooks/useProgressiveAnalysis.ts`
- `src/hooks/useClarifyingQuestions.ts`
- `src/hooks/useDocumentReferences.ts`
- `src/hooks/useElevenLabsSTT.ts`, `useHuggingFaceSTT.ts`
- `src/types/meeting.ts`, `src/lib/storage.ts`, `src/pages/Index.tsx`

v2:
- `src/lib/components/LiveMeetingView.svelte`, `CanvasView.svelte`, `FlowCanvas.svelte`
- `src/lib/live-audio.ts`, `progressive-map.ts`, `live-session.ts`, `api.ts`
- `shared/ai.ts`, `analysis.ts`, `db.ts`, `meeting-transcript.ts`
- `apps/api/src/index.ts`

## D1 failure diagnosis and changes

The reported `D1_ERROR: Network connection lost` is a transient infrastructure error. The precise production query that failed is not identifiable from that message alone; no historical trace was available during this review.

Concrete problems in the former request path:
1. `getEnv()` executed seven `CREATE TABLE/INDEX IF NOT EXISTS` statements on **every** API request, including STT.
2. Segment persistence combined a read/append/write to R2, a D1 insert, and a separate D1 metadata update. There was no shared transaction, stable client segment ID, or safe whole-request retry.
3. The live UI appended recognized text only **after** saving succeeded. A database error could hide already-transcribed speech.
4. Final-analysis event callbacks returned promises but were not awaited. Database error reporting could itself fail and mask the original error.

Changes:
- Explicit schema migration replaces request-time DDL. STT and preview analysis do not access D1.
- New meetings keep their original R2 text immutable and store live segments in D1. Atomic insert + count update, stable IDs, ordered reads and bounded transient retries make saving replay-safe.
- Legacy meetings read their original R2 transcript to avoid duplicating historical segments.
- Recognized text appears immediately with visible save status; local recovery and download remain available during outages. Raw audio is not backed up.
- Failed finalization stays on the transcript/canvas screen with retry controls. Success does not discard the transcript before review.
- Streaming writes are awaited; error responses no longer include server stack traces.

## Timestamped saved transcripts

Saved meetings now offer **Timestamps** and **Plain text** transcript views. The meeting API returns ordered D1 segments plus the original base transcript, so imported notes are retained without duplication. Segment timestamps are local wall-clock transcription completion times, not exact audio offsets or word timings. Older/imported transcripts without saved segment timing show the original text and an explicit unavailable notice; no timestamps are fabricated. Leaving a completed live meeting preserves its segments for immediate review.

## Background references

See [document-references.md](document-references.md) for the queue/outbox design, migrations, resource setup, and known upstream HTTP 500 during semantic search. Retrieval uses the actual Policy Observatory provisions API, not the `/v1/docs` Swagger page. Positive real-search results still need validation after the upstream error is resolved.

## Limits / follow-up work

- This is not yet full original parity: clarifying questions, change history, partial text and speaker diarization remain outstanding. Automatic document retrieval is implemented; generated reference answers and match confidence are not.
- Layout has two deterministic modes: a stable downward topic-order lane and a compact layered canvas with up to three branches per row. This is not an exact port of the original layout; dense or returning connections may overlap. Both views use the same map without semantic deduplication, and saved graphs are snapshots rather than historical replays.
- New speech presets default to Whisper with a Tagalog hint for Filipino/English and 12-second clips. VAD and language hints are implemented, but representative mixed-language audio still needs an accuracy evaluation; changing analysis cannot repair misrecognized source text.
- Preview analysis uses the latest 40 topics as model context and merges updates into the full client map. Final analysis still uses the v2 chunk pipeline; it can split recurring topics between chunks rather than globally deduplicating them.
- Drafts contain sensitive transcript text in browser localStorage. They are cleared on Save & exit / Discard draft. Storage availability/quota and browser clearing affect recovery; download is the fallback.
- A lost STT chunk cannot be recreated from a text-only draft. Saving retries recover recognized text, not unavailable audio.
- Existing open clients must reload after deployment to use the new segment payload. Saved old meetings remain readable; old in-progress sessions cannot append with the obsolete payload.
- The production outage and actual tab sharing still need manual end-to-end validation. Automated coverage includes a real local D1/R2 runtime, simulated lost acknowledgements, incremental map scheduling, and failure/recovery behavior.
