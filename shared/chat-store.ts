import type { D1Database } from '@cloudflare/workers-types';
import type { ChatSession, ChatSessionData, ChatTurn, SavedChatMessage, SendChatTurn } from './chat-types';
import { retryIdempotent } from './retry.ts';

export class ChatError extends Error {
	status: 400 | 404 | 409 | 502;
	constructor(message: string, status: 400 | 404 | 409 | 502 = 409) { super(message); this.status = status; }
}
const LEASE_MS = 120000;
interface TurnRow extends ChatTurn { lease_token: string | null }

export async function getChatSession(db: D1Database, meetingId: string, id: string): Promise<ChatSession> {
	const row = await retryIdempotent(() => db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND meeting_id = ?').bind(id, meetingId).first<ChatSession>());
	if (!row) throw new ChatError('Chat not found in this meeting.', 404);
	return row;
}
export async function listChatSessions(db: D1Database, meetingId: string, offset = 0) {
	const { results } = await retryIdempotent(() => db.prepare('SELECT * FROM chat_sessions WHERE meeting_id = ? ORDER BY updated_at DESC, id LIMIT 51 OFFSET ?').bind(meetingId, offset).all<ChatSession>());
	return { sessions: results.slice(0, 50), hasMore: results.length > 50 };
}
export async function createChatSession(db: D1Database, session: ChatSession) {
	await retryIdempotent(() => db.prepare(`INSERT INTO chat_sessions (id, meeting_id, title, provider, model, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(session.id, session.meeting_id, session.title, session.provider, session.model, session.created_at, session.updated_at).run());
	return getChatSession(db, session.meeting_id, session.id);
}
export async function deleteChatSession(db: D1Database, meetingId: string, id: string) {
	await retryIdempotent(() => db.prepare('DELETE FROM chat_sessions WHERE id = ? AND meeting_id = ?').bind(id, meetingId).run());
}
async function getTurn(db: D1Database, sessionId: string, id: string) {
	return retryIdempotent(() => db.prepare('SELECT * FROM chat_turns WHERE id = ? AND session_id = ?').bind(id, sessionId).first<TurnRow>());
}
export async function readChatSession(db: D1Database, meetingId: string, id: string, before = Number.MAX_SAFE_INTEGER): Promise<ChatSessionData> {
	const session = await getChatSession(db, meetingId, id);
	const [{ results }, latest] = await Promise.all([
		retryIdempotent(() => db.prepare(`SELECT id, role, content, position, turn_id, created_at FROM messages
			WHERE session_id = ? AND position < ? AND role IN ('user','assistant') ORDER BY position DESC LIMIT 51`).bind(id, before).all<SavedChatMessage>()),
		retryIdempotent(() => db.prepare('SELECT * FROM chat_turns WHERE session_id = ? ORDER BY position DESC LIMIT 1').bind(id).first<TurnRow>())
	]);
	const messages = results.slice(0, 50).reverse();
	let latestTurn: ChatTurn | null = null;
	if (latest) {
		const { lease_token: _token, ...visible } = latest;
		latestTurn = visible;
		if (visible.status === 'pending' && visible.lease_until <= Date.now()) {
			latestTurn = { ...visible, status: 'error', error: 'The response was interrupted. Retry this message.' };
		}
	}
	return { session, messages, before: results.length > 50 ? messages[0].position : null, latestTurn };
}

/** Persist the user's message before inference. One pending turn per session, guarded in SQLite.
 * Stable client IDs deduplicate retries, including an ambiguous D1 write acknowledgement. */
export async function claimChatTurn(db: D1Database, meetingId: string, sessionId: string, request: SendChatTurn) {
	await getChatSession(db, meetingId, sessionId);
	const existing = await getTurn(db, sessionId, request.id);
	if (existing && (existing.content !== request.content || existing.provider !== request.provider || existing.model !== request.model)) {
		throw new ChatError('This message ID was already used for different content.');
	}
	if (existing?.status === 'complete') return { cached: true as const };
	const now = Date.now();
	const iso = new Date(now).toISOString();
	const token = crypto.randomUUID();
	await retryIdempotent(() => db.batch([
		db.prepare(`UPDATE chat_turns SET status = 'error', error = 'The response was interrupted. Retry this message.', lease_token = NULL, updated_at = ?
			WHERE session_id = ? AND status = 'pending' AND lease_until <= ?`).bind(iso, sessionId, now),
		db.prepare(`INSERT INTO chat_turns (id, session_id, position, content, provider, model, status, lease_token, lease_until, created_at, updated_at)
			SELECT ?, s.id, (SELECT COALESCE(MAX(position), 0) + 1 FROM messages WHERE session_id = s.id), ?, ?, ?, 'pending', ?, ?, ?, ?
			FROM chat_sessions s WHERE s.id = ? AND s.meeting_id = ?
			AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE session_id = s.id AND status = 'pending')
			ON CONFLICT(id) DO NOTHING`).bind(request.id, request.content, request.provider, request.model, token, now + LEASE_MS, iso, iso, sessionId, meetingId),
		db.prepare(`UPDATE chat_turns SET status = 'pending', error = NULL, lease_token = ?, lease_until = ?, updated_at = ?
			WHERE id = ? AND session_id = ? AND status = 'error' AND content = ? AND provider = ? AND model = ?
			AND NOT EXISTS (SELECT 1 FROM chat_turns other WHERE other.session_id = ? AND (other.status = 'pending' OR other.position > chat_turns.position))`)
			.bind(token, now + LEASE_MS, iso, request.id, sessionId, request.content, request.provider, request.model, sessionId),
		db.prepare(`INSERT INTO messages (id, meeting_id, session_id, turn_id, position, role, content, provider, model, created_at)
			SELECT ?, ?, session_id, id, position, 'user', content, provider, model, created_at FROM chat_turns WHERE id = ? AND lease_token = ?
			ON CONFLICT(id) DO NOTHING`).bind(`${request.id}:user`, meetingId, request.id, token),
		db.prepare(`UPDATE chat_sessions SET title = CASE WHEN title = 'New chat' THEN ? ELSE title END, provider = ?, model = ?, updated_at = ?
			WHERE id = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND lease_token = ?)`)
			.bind(request.content.replace(/\s+/g, ' ').slice(0, 80), request.provider, request.model, iso, sessionId, request.id, token)
	]));
	const turn = await getTurn(db, sessionId, request.id);
	if (turn?.content === request.content && turn.provider === request.provider && turn.model === request.model) {
		if (turn.status === 'complete') return { cached: true as const };
		if (turn.lease_token === token) return { cached: false as const, token, turn };
	}
	throw new ChatError('This chat is busy or the message is no longer retryable. Refresh the chat before sending again.');
}

export async function finishChatTurn(db: D1Database, meetingId: string, sessionId: string, id: string, token: string, content: string) {
	const now = Date.now();
	const iso = new Date(now).toISOString();
	await retryIdempotent(() => db.batch([
		db.prepare(`INSERT INTO messages (id, meeting_id, session_id, turn_id, position, role, content, provider, model, created_at)
			SELECT ?, ?, session_id, id, position + 1, 'assistant', ?, provider, model, ? FROM chat_turns
			WHERE id = ? AND session_id = ? AND lease_token = ? AND status = 'pending' AND lease_until > ?
			ON CONFLICT(id) DO NOTHING`).bind(`${id}:assistant`, meetingId, content, iso, id, sessionId, token, now),
		db.prepare(`UPDATE chat_turns SET status = 'complete', lease_token = NULL, lease_until = 0, error = NULL, updated_at = ?
			WHERE id = ? AND session_id = ? AND lease_token = ? AND status = 'pending' AND lease_until > ?`).bind(iso, id, sessionId, token, now),
		db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ? AND EXISTS
			(SELECT 1 FROM chat_turns WHERE id = ? AND session_id = ? AND status = 'complete')`).bind(iso, sessionId, id, sessionId)
	]));
	if ((await getTurn(db, sessionId, id))?.status !== 'complete') throw new ChatError('Chat was deleted or this response expired. Refresh before retrying.');
}
export async function failChatTurn(db: D1Database, id: string, token: string) {
	await retryIdempotent(() => db.prepare(`UPDATE chat_turns SET status = 'error', error = 'The reply could not be completed. Retry this message.',
		lease_token = NULL, lease_until = 0, updated_at = ? WHERE id = ? AND lease_token = ? AND status = 'pending'`).bind(new Date().toISOString(), id, token).run());
}

/** Only completed turns and imported history become model context; never trust a client transcript. */
export async function readChatHistory(db: D1Database, sessionId: string, position: number) {
	const { results } = await retryIdempotent(() => db.prepare(`SELECT m.role, m.content FROM messages m
		LEFT JOIN chat_turns t ON t.id = m.turn_id WHERE m.session_id = ? AND m.position < ?
		AND m.role IN ('user','assistant') AND (m.turn_id IS NULL OR t.status = 'complete')
		ORDER BY m.position DESC LIMIT 40`).bind(sessionId, position).all<Pick<SavedChatMessage, 'role' | 'content'>>());
	return results.reverse();
}
