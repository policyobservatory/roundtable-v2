-- Explicit initialization; never run DDL on audio or other request paths.
-- IF NOT EXISTS makes this safe for existing v2 databases.
CREATE TABLE IF NOT EXISTS meetings (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 provider TEXT NOT NULL, model TEXT NOT NULL, transcript_key TEXT NOT NULL,
 segmented INTEGER NOT NULL DEFAULT 0, metadata TEXT, map TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_chunks (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
 start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, summary TEXT NOT NULL,
 nodes TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS segments (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, segment_index INTEGER NOT NULL,
 text TEXT NOT NULL, audio_key TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, meeting_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
 provider TEXT, model TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON analysis_chunks(meeting_id);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages(meeting_id);
