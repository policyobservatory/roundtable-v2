import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { listMeetings, createMeeting } from '$lib/db';
import { putTranscript } from '$lib/storage';
import type { AIProvider, Meeting } from '$lib/types';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const meetings = await listMeetings(env.DB);
	return json(meetings);
};

export const POST: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const body = (await event.request.json()) as Record<string, unknown>;
	const transcript: string = (body.transcript as string) ?? '';
	const title: string = (body.title as string)?.trim() || `Meeting ${new Date().toLocaleDateString()}`;
	const provider: AIProvider = (body.provider as AIProvider) ?? 'openrouter';
	const model: string = (body.model as string) ?? env.OPENROUTER_MODEL;

	const id = crypto.randomUUID();
	const transcriptKey = `transcripts/${id}.txt`;

	await putTranscript(env.TRANSCRIPTS, transcriptKey, transcript);

	const meeting: Meeting = {
		id,
		title,
		status: 'pending',
		provider,
		model,
		transcript_key: transcriptKey,
		segmented: 0,
		metadata: { length: transcript.length, chunksEstimated: Math.ceil(transcript.length / env.TRANSCRIPT_CHUNK_SIZE) },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};

	await createMeeting(env.DB, meeting);

	return json({ id, title, status: meeting.status }, { status: 201 });
};
