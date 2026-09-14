import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { getMeeting, deleteMeeting } from '$lib/db';
import { getChunks } from '$lib/db';
import { getTranscript, deleteTranscript } from '$lib/storage';
import { json, error } from '@sveltejs/kit';

export const GET: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const { id } = event.params;
	const meeting = await getMeeting(env.DB, id);
	if (!meeting) throw error(404, 'Meeting not found');
	const [transcript, chunks] = await Promise.all([
		getTranscript(env.TRANSCRIPTS, meeting.transcript_key),
		getChunks(env.DB, id)
	]);
	return json({ meeting, transcript, chunks });
};

export const DELETE: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const { id } = event.params;
	const meeting = await getMeeting(env.DB, id);
	if (meeting) {
		await Promise.all([deleteTranscript(env.TRANSCRIPTS, meeting.transcript_key), deleteMeeting(env.DB, id)]);
	}
	return json({ ok: true });
};
