-- Persistent conversations within a meeting. Run once via D1 migrations, never on requests.
CREATE TABLE chat_sessions (
 id TEXT PRIMARY KEY,
 meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 title TEXT NOT NULL DEFAULT 'New chat',
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_chat_sessions_meeting ON chat_sessions(meeting_id, updated_at DESC, id);

ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN turn_id TEXT;
ALTER TABLE messages ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_chat_message_position ON messages(session_id, position) WHERE session_id IS NOT NULL;
CREATE INDEX idx_chat_message_turn ON messages(turn_id, role);

CREATE TABLE chat_turns (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 content TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending', 'complete', 'error')),
 error TEXT,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(session_id, position)
);
CREATE UNIQUE INDEX idx_chat_turn_pending ON chat_turns(session_id) WHERE status = 'pending';

-- Old logs have no session boundaries. Preserve them in one explicitly imported chat per meeting.
INSERT INTO chat_sessions (id, meeting_id, title, provider, model, created_at, updated_at)
 SELECT 'legacy-' || m.id, m.id, 'Previous chat (imported)', m.provider, m.model,
 MIN(msg.created_at), MAX(msg.created_at)
 FROM meetings m JOIN messages msg ON msg.meeting_id = m.id GROUP BY m.id;
WITH ordered AS (
 SELECT id, ROW_NUMBER() OVER (PARTITION BY meeting_id ORDER BY created_at, rowid) AS n
 FROM messages WHERE meeting_id IS NOT NULL
)
UPDATE messages SET session_id = 'legacy-' || meeting_id,
 position = (SELECT n FROM ordered WHERE ordered.id = messages.id)
 WHERE meeting_id IS NOT NULL;
