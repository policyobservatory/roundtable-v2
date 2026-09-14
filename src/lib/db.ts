import type { D1Database } from '@cloudflare/workers-types';
import type { AnalysisChunk, ChatMessage, Meeting, Segment } from './types';

const MIGRATIONS = [
	`CREATE TABLE IF NOT EXISTS meetings (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		provider TEXT NOT NULL,
		model TEXT NOT NULL,
		transcript_key TEXT NOT NULL,
		segmented INTEGER NOT NULL DEFAULT 0,
		metadata TEXT,
		map TEXT,
		error TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS analysis_chunks (
		id TEXT PRIMARY KEY,
		meeting_id TEXT NOT NULL,
		chunk_index INTEGER NOT NULL,
		start_offset INTEGER NOT NULL,
		end_offset INTEGER NOT NULL,
		summary TEXT NOT NULL,
		nodes TEXT NOT NULL,
		created_at TEXT NOT NULL,
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
	);`,
	`CREATE TABLE IF NOT EXISTS segments (
		id TEXT PRIMARY KEY,
		meeting_id TEXT NOT NULL,
		segment_index INTEGER NOT NULL,
		text TEXT NOT NULL,
		audio_key TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		created_at TEXT NOT NULL,
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
	);`,
	`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		meeting_id TEXT,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		provider TEXT,
		model TEXT,
		created_at TEXT NOT NULL,
		FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
	);`,
	`CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON analysis_chunks(meeting_id);`,
	`CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id);`,
	`CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages(meeting_id);`
];

export async function migrate(db: D1Database) {
	for (const sql of MIGRATIONS) {
		await db.prepare(sql).run();
	}
}

export async function listMeetings(db: D1Database): Promise<Meeting[]> {
	const { results } = await db
		.prepare('SELECT * FROM meetings ORDER BY updated_at DESC')
		.all<Meeting>();
	return results?.map(deserializeMeeting) ?? [];
}

export async function getMeeting(db: D1Database, id: string): Promise<Meeting | null> {
	const row = await db.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<Meeting>();
	return row ? deserializeMeeting(row) : null;
}

export async function createMeeting(db: D1Database, meeting: Meeting): Promise<void> {
	await db
		.prepare(
			`INSERT INTO meetings (id, title, status, provider, model, transcript_key, segmented, metadata, map, error, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			meeting.id,
			meeting.title,
			meeting.status,
			meeting.provider,
			meeting.model,
			meeting.transcript_key,
			meeting.segmented,
			JSON.stringify(meeting.metadata),
			meeting.map ? JSON.stringify(meeting.map) : null,
			meeting.error ?? null,
			meeting.created_at,
			meeting.updated_at
		)
		.run();
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
	if (sets.length === 0) return;
	sets.push('updated_at = ?');
	values.push(new Date().toISOString());
	values.push(id);
	await db.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteMeeting(db: D1Database, id: string): Promise<void> {
	await db.prepare('DELETE FROM meetings WHERE id = ?').bind(id).run();
}

export async function insertChunk(db: D1Database, chunk: AnalysisChunk): Promise<void> {
	await db
		.prepare(
			`INSERT INTO analysis_chunks (id, meeting_id, chunk_index, start_offset, end_offset, summary, nodes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			chunk.id,
			chunk.meeting_id,
			chunk.chunk_index,
			chunk.start_offset,
			chunk.end_offset,
			chunk.summary,
			JSON.stringify(chunk.nodes),
			chunk.created_at
		)
		.run();
}

export async function getChunks(db: D1Database, meetingId: string): Promise<AnalysisChunk[]> {
	const { results } = await db
		.prepare('SELECT * FROM analysis_chunks WHERE meeting_id = ? ORDER BY chunk_index')
		.bind(meetingId)
		.all<AnalysisChunk>();
	return (results ?? []).map((row) => ({
		...row,
		nodes: JSON.parse(row.nodes as unknown as string)
	}));
}

export async function insertSegment(db: D1Database, segment: Segment): Promise<void> {
	await db
		.prepare(
			`INSERT INTO segments (id, meeting_id, segment_index, text, audio_key, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(segment.id, segment.meeting_id, segment.segment_index, segment.text, segment.audio_key ?? null, segment.status, segment.created_at)
		.run();
}

export async function saveMessage(
	db: D1Database,
	message: { id: string; meeting_id?: string; role: ChatMessage['role']; content: string; provider?: string; model?: string; created_at: string }
): Promise<void> {
	await db
		.prepare(`INSERT INTO messages (id, meeting_id, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
		.bind(message.id, message.meeting_id ?? null, message.role, message.content, message.provider ?? null, message.model ?? null, message.created_at)
		.run();
}

export async function listMessages(db: D1Database, meetingId?: string): Promise<{ role: string; content: string }[]> {
	let stmt;
	if (meetingId) {
		stmt = db.prepare('SELECT role, content FROM messages WHERE meeting_id = ? ORDER BY created_at').bind(meetingId);
	} else {
		stmt = db.prepare('SELECT role, content FROM messages ORDER BY created_at');
	}
	const { results } = await stmt.all<{ role: string; content: string }>();
	return results ?? [];
}

function deserializeMeeting(row: Meeting): Meeting {
	return {
		...row,
		metadata: row.metadata ? (JSON.parse(row.metadata as unknown as string) as Record<string, unknown>) : {},
		map: row.map ? (JSON.parse(row.map as unknown as string) as Meeting['map']) : undefined
	};
}
