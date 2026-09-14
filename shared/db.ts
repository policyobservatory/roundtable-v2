import type { D1Database } from '@cloudflare/workers-types';
import type { AnalysisChunk, ChatMessage, Meeting, Segment } from './types';
import { retryIdempotent } from './retry.ts';

export async function listMeetings(db: D1Database): Promise<Meeting[]> {
	const { results } = await retryIdempotent(() => db.prepare('SELECT * FROM meetings ORDER BY updated_at DESC').all<Meeting>());
	return results?.map(deserializeMeeting) ?? [];
}

export async function getMeeting(db: D1Database, id: string): Promise<Meeting | null> {
	const row = await retryIdempotent(() => db.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<Meeting>());
	return row ? deserializeMeeting(row) : null;
}

export async function createMeeting(db: D1Database, meeting: Meeting): Promise<void> {
	await retryIdempotent(() => db.prepare(
		`INSERT INTO meetings (id, title, status, provider, model, transcript_key, segmented, metadata, map, error, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
	).bind(meeting.id, meeting.title, meeting.status, meeting.provider, meeting.model, meeting.transcript_key,
		meeting.segmented, JSON.stringify(meeting.metadata), meeting.map ? JSON.stringify(meeting.map) : null,
		meeting.error ?? null, meeting.created_at, meeting.updated_at).run());
}

export async function updateMeeting(db: D1Database, id: string, patch: Partial<Meeting>): Promise<void> {
	const sets: string[] = [];
	const values: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (key === 'metadata' || key === 'map') {
			sets.push(`${key} = ?`);
			values.push(value ? JSON.stringify(value) : null);
		} else {
			sets.push(`${key} = ?`);
			values.push(value ?? null);
		}
	}
	if (!sets.length) return;
	sets.push('updated_at = ?');
	values.push(new Date().toISOString(), id);
	await retryIdempotent(() => db.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run());
}

export async function deleteMeeting(db: D1Database, id: string): Promise<void> {
	await retryIdempotent(() => db.prepare('DELETE FROM meetings WHERE id = ?').bind(id).run());
}

export async function insertChunk(db: D1Database, chunk: AnalysisChunk): Promise<void> {
	await retryIdempotent(() => db.prepare(
		`INSERT INTO analysis_chunks (id, meeting_id, chunk_index, start_offset, end_offset, summary, nodes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
		 summary = excluded.summary, nodes = excluded.nodes, start_offset = excluded.start_offset, end_offset = excluded.end_offset`
	).bind(chunk.id, chunk.meeting_id, chunk.chunk_index, chunk.start_offset, chunk.end_offset,
		chunk.summary, JSON.stringify(chunk.nodes), chunk.created_at).run());
}

export async function getChunks(db: D1Database, meetingId: string): Promise<AnalysisChunk[]> {
	const { results } = await retryIdempotent(() => db.prepare('SELECT * FROM analysis_chunks WHERE meeting_id = ? ORDER BY chunk_index')
		.bind(meetingId).all<AnalysisChunk>());
	return (results ?? []).map((row) => ({ ...row, nodes: JSON.parse(row.nodes as unknown as string) }));
}

export async function getSegments(db: D1Database, meetingId: string): Promise<Segment[]> {
	const { results } = await retryIdempotent(() => db.prepare('SELECT * FROM segments WHERE meeting_id = ? ORDER BY segment_index, created_at, id')
		.bind(meetingId).all<Segment>());
	return results ?? [];
}

/** Both statements are atomic. Replaying an acknowledged-or-lost request cannot duplicate text or counts. */
export async function saveSegment(db: D1Database, segment: Segment): Promise<void> {
	await retryIdempotent(() => db.batch([
		db.prepare(`INSERT INTO segments (id, meeting_id, segment_index, text, audio_key, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
			.bind(segment.id, segment.meeting_id, segment.segment_index, segment.text, segment.audio_key ?? null, segment.status, segment.created_at),
		db.prepare(`UPDATE meetings SET segmented = 1,
			metadata = json_set(COALESCE(metadata, '{}'), '$.segmentCount', (SELECT COUNT(*) FROM segments WHERE meeting_id = ?)),
			updated_at = MAX(updated_at, ?) WHERE id = ?`)
			.bind(segment.meeting_id, segment.created_at, segment.meeting_id)
	]));
}

export async function findSegment(db: D1Database, id: string): Promise<Segment | null> {
	return retryIdempotent(() => db.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first<Segment>());
}

export async function saveMessage(
	db: D1Database,
	message: { id: string; meeting_id?: string; role: ChatMessage['role']; content: string; provider?: string; model?: string; created_at: string }
): Promise<void> {
	await retryIdempotent(() => db.prepare(`INSERT INTO messages (id, meeting_id, role, content, provider, model, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
		.bind(message.id, message.meeting_id ?? null, message.role, message.content, message.provider ?? null, message.model ?? null, message.created_at).run());
}

export async function listMessages(db: D1Database, meetingId?: string): Promise<{ role: string; content: string }[]> {
	const { results } = await retryIdempotent(() => (meetingId
		? db.prepare('SELECT role, content FROM messages WHERE meeting_id = ? ORDER BY created_at').bind(meetingId)
		: db.prepare('SELECT role, content FROM messages ORDER BY created_at')).all<{ role: string; content: string }>());
	return results ?? [];
}

function deserializeMeeting(row: Meeting): Meeting {
	return {
		...row,
		metadata: row.metadata ? (JSON.parse(row.metadata as unknown as string) as Record<string, unknown>) : {},
		map: row.map ? (JSON.parse(row.map as unknown as string) as Meeting['map']) : undefined
	};
}
