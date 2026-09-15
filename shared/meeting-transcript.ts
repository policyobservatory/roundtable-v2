import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Meeting } from './types';
import { getSegments } from './db.ts';
import { getTranscript } from './storage.ts';

/** Legacy meetings already have appended R2 text; new ones keep immutable, ordered D1 segments. */
export async function readMeetingTranscriptData(db: D1Database, bucket: R2Bucket, meeting: Meeting) {
	const [stored, segments] = await Promise.all([
		getTranscript(bucket, meeting.transcript_key),
		meeting.metadata.segmentStorage === 'd1' ? getSegments(db, meeting.id) : Promise.resolve([])
	]);
	const baseTranscript = stored ?? '';
	return {
		baseTranscript,
		segments,
		transcript: [baseTranscript, ...segments.map((segment) => segment.text)].filter(Boolean).join('\n')
	};
}

export async function readMeetingTranscript(db: D1Database, bucket: R2Bucket, meeting: Meeting): Promise<string> {
	return (await readMeetingTranscriptData(db, bucket, meeting)).transcript;
}
