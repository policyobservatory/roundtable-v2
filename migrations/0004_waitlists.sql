-- Apply with D1 migrations before deploying the waitlist API.
CREATE TABLE waitlists (
	id TEXT PRIMARY KEY NOT NULL,
	first_name TEXT NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 80),
	email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
	industry TEXT CHECK (industry IS NULL OR industry IN (
		'legislature', 'government', 'legal', 'policy-research', 'education',
		'nonprofit', 'media', 'technology', 'business', 'other'
	)),
	consent_version TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX waitlists_created_at ON waitlists(created_at);
