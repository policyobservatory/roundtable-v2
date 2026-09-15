# Persistent meeting chats

## Status and storage

Meeting chat uses **D1**, not Durable Objects. Each meeting can have multiple `chat_sessions`; `messages.session_id` separates histories. `chat_turns` records pending/completed/failed requests so interrupted replies and retries are visible after reopening the chat.

The UI provides New chat, a saved-chat selector, Refresh, Delete chat, and paginated older messages/chats. The first send creates a chat if none exists; the first question becomes its title. The selected chat ID is remembered in local storage, but the messages themselves are loaded from D1. Browser storage is optional. Closing the panel or reloading does not remove saved messages. Unsubmitted drafts are not persisted.

Deletion cascades to that chat's messages and turns, not the transcript or other chats. Deleting the meeting cascades to all its chats. There are no WebSockets or cross-tab live broadcasts; a selected pending chat polls every three seconds and Refresh retrieves other changes.

## API

All session routes are scoped to a meeting:

- `GET /api/meetings/:meetingId/chats?offset=0`: up to 50 sessions, plus `hasMore`.
- `POST /api/meetings/:meetingId/chats`: `{ id, provider, model, title? }`. The client-generated UUID makes creation retries idempotent.
- `GET /api/meetings/:meetingId/chats/:sessionId?before=<position>`: session, up to 50 messages, an older-page cursor, and latest turn status. Responses have `Cache-Control: no-store`.
- `DELETE /api/meetings/:meetingId/chats/:sessionId`: deletes only that scoped chat.
- `POST /api/meetings/:meetingId/chats/:sessionId/messages`: `{ id, content, provider, model }`. Content is 1–4,000 characters. Client-supplied history/system messages are rejected.

The older `/api/chat` endpoint returns a reload instruction for meeting chats to avoid writing new history without a session. Existing standalone calls without a meeting ID retain their legacy behavior.

## Request reliability

1. An atomic D1 batch claims a turn and stores the user message **before** model inference.
2. A partial unique index allows one pending turn per session. A concurrent send in that session gets HTTP 409; other sessions remain independent.
3. A stable UUID identifies the request. Replaying a completed request returns stored history without invoking the model again. Reusing an ID with different content/model is rejected.
4. The handler allows 90 seconds for context/retrieval/inference and uses a two-minute processing lease. Failed replies remain retryable with the same ID; only the latest failed turn can be retried after other turns exist.
5. The assistant message and completion state are saved atomically. Lease tokens prevent a stale attempt from overwriting a retry, and deletion cannot resurrect a session.
6. A crashed/terminated Worker leaves a saved user message. Once the lease expires, reopening/polling exposes a retryable interrupted state. There is **no automatic background generation recovery** and no exactly-once inference guarantee if an attempt crashes before saving its answer.

This is not an Agents SDK/Durable Object session. D1 handles persistence and short transactional claims; a future shared streaming chat could add a Durable Object for coordination.

## Model context

The server—not the browser—loads the selected session's completed messages. Failed/pending turns do not become conversational context. Imported history is retained.

Context is bounded conservatively by characters, not an exact model tokenizer:

- At most 40 recent messages are queried, with at most 20 messages / 10,000 characters passed on, capped at 3,000 characters per message.
- The transcript is divided into overlapping passages. Keyword matches from the current question and recent user questions select up to four 1,800-character passages. Broad questions sample across the meeting instead of taking only its beginning.
- Up to 12 evenly distributed analysis summaries provide an overview with a roughly 3,600-character budget.
- A best-effort Policy Observatory search uses the question; up to three document excerpts are included, at 900 characters each.

Transcript passages carry character offsets for citations. This is **lexical retrieval, not semantic/vector search**, and is not exhaustive. Filipino/English synonym or paraphrase recall remains limited. The system prompt labels sources as untrusted data and asks the model to acknowledge missing evidence. Upstream document failures do not block transcript-based chat and do not imply that no matching documents exist.

## Migration and rollout

Apply `migrations/0003_chat_sessions.sql` before deploying the session-enabled API/frontend. It adds the session/turn tables and message columns/indexes. It preserves existing meeting messages in one **Previous chat (imported)** session per meeting, ordered by creation time and insertion order. Original session boundaries cannot be recovered because they were never stored. Standalone messages remain unassigned.

Do not run DDL on request paths. Reload old browser tabs after deployment. Local tests apply the migration only to disposable test databases; production rollout requires the explicit remote migration step.

## Security boundary

Roundtable currently has no user authentication or meeting access controls. Meeting-scoped SQL checks prevent mixing a session with the wrong meeting ID, but **session IDs are not authorization** and these chats are not private user accounts. Before exposing this app to untrusted users, add authenticated meeting membership checks, per-user quotas, and rate limits to all meeting/session endpoints.

## Validation

`tests/chat-sessions.test.mjs` uses real local D1 with mocked inference/retrieval. It covers migration, scoped access, persistence, history sourcing, duplicate IDs, concurrent sends, failures/retries, ambiguous writes, expired leases, deletion during inference, pagination, and late-transcript retrieval. Browser checks cover reopening, page reload, separate sessions, retry without duplicate user messages, deletion, and existing composer/Markdown behavior. No production inference or database migration is performed by these tests.
