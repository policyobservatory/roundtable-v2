-- Immutable content-addressed reference jobs double as a durable queue outbox.
-- They do not write into meetings.map or depend on live-preview persistence.
CREATE TABLE IF NOT EXISTS document_jobs (
 id TEXT PRIMARY KEY,
 meeting_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 query TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','searching','ready','empty','error')),
 attempts INTEGER NOT NULL DEFAULT 0,
 dispatch_after INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 documents TEXT NOT NULL DEFAULT '[]',
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(meeting_id, fingerprint),
 FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_jobs_dispatch ON document_jobs(status, dispatch_after);
CREATE INDEX IF NOT EXISTS idx_document_jobs_meeting ON document_jobs(meeting_id);
