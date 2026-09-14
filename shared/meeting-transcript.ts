import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Meeting } from './types';
import { getSegments } from './db.ts';
import { getTranscript } from './storage.ts';

/** Legacy meetings already have appended R2 text; new ones keep immutable, ordered D1 segments. */
export async function readMeetingTranscript(db: D1Database, bucket: R2Bucket, meeting: Meeting): Promise<string> {
	const base = await getTranscript(bucket, meeting.transcript_key) ?? '';
	if (meeting.metadata.segmentStorage !== 'd1') return base;
	const segments = await getSegments(db, meeting.id);
	return [base, ...segments.map((segment) => segment.text)].filter(Boolean).join('\n');
}
