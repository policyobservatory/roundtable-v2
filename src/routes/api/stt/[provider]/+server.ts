import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { transcribeAudio } from '$lib/stt';
import type { STTProvider } from '$lib/types';
import { json, error } from '@sveltejs/kit';

export const POST: RequestHandler = async (event) => {
	const provider = event.params.provider as STTProvider;
	const valid: STTProvider[] = ['huggingface', 'deepgram', 'elevenlabs'];
	if (!valid.includes(provider)) throw error(400, 'Invalid STT provider');

	const { env } = await initPlatform(event);
	const audio = await event.request.blob();
	if (!audio || audio.size === 0) throw error(400, 'Missing audio file');

	const result = await transcribeAudio(provider, audio, env);
	return json(result);
};
