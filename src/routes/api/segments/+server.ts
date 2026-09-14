import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { getMeeting, insertSegment, updateMeeting } from '$lib/db';
import { appendTranscript, putAudio } from '$lib/storage';
import { json, error } from '@sveltejs/kit';

export const POST: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const body = (await event.request.json()) as Record<string, unknown>;
	const meetingId: string = body.meeting_id as string;
	const text: string = (body.text as string) ?? '';
	const audioBase64: string | undefined = body.audio_base64 as string | undefined;
	const audioMime: string = (body.audio_mime as string) || 'audio/webm';

	if (!meetingId) throw error(400, 'meeting_id is required');
	const meeting = await getMeeting(env.DB, meetingId);
	if (!meeting) throw error(404, 'Meeting not found');

	const segmentIndex = (meeting.metadata.segmentCount as number | undefined) ?? 0;

	let audioKey: string | undefined;
	if (audioBase64) {
		const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
		audioKey = `audio/${meetingId}/${segmentIndex}.webm`;
		await putAudio(env.AUDIO, audioKey, new Blob([bytes], { type: audioMime }));
	}

	await appendTranscript(env.TRANSCRIPTS, meeting.transcript_key, text);

	const segment = {
		id: crypto.randomUUID(),
		meeting_id: meetingId,
		segment_index: segmentIndex,
		text,
		audio_key: audioKey,
		status: 'transcribed' as const,
		created_at: new Date().toISOString()
	};
	await insertSegment(env.DB, segment);

	const metadata = {
		...meeting.metadata,
		segmentCount: segmentIndex + 1,
		lastSegmentAt: segment.created_at
	};
	await updateMeeting(env.DB, meetingId, {
		segmented: 1,
		metadata,
		status: meeting.status === 'pending' ? 'analyzing' : meeting.status
	});

	return json(segment, { status: 201 });
};
