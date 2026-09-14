import type { AppEnv } from './env';
import type { STTProvider } from './types';

export async function transcribeAudio(
	provider: STTProvider,
	audio: Blob,
	env: AppEnv
): Promise<{ text: string }> {
	switch (provider) {
		case 'huggingface':
			return huggingFaceSTT(audio, env);
		case 'deepgram':
			return deepgramSTT(audio, env);
		case 'elevenlabs':
			return elevenLabsSTT(audio, env);
		default:
			throw new Error(`Unsupported STT provider: ${provider}`);
	}
}

async function huggingFaceSTT(audio: Blob, env: AppEnv): Promise<{ text: string }> {
	if (!env.HF_TOKEN) throw new Error('Missing HF_TOKEN');
	const model = env.HF_STT_MODEL;
	const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.HF_TOKEN}`,
			'Content-Type': audio.type || 'audio/webm'
		},
		body: await audio.arrayBuffer()
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`HuggingFace STT error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as { text?: string } | string;
	if (typeof data === 'string') return { text: data };
	return { text: data.text ?? '' };
}

async function deepgramSTT(audio: Blob, env: AppEnv): Promise<{ text: string }> {
	if (!env.DEEPGRAM_API_KEY) throw new Error('Missing DEEPGRAM_API_KEY');
	const model = env.DEEPGRAM_STT_MODEL;
	const res = await fetch(`https://api.deepgram.com/v1/listen?model=${model}&smart_format=true`, {
		method: 'POST',
		headers: {
			Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
			'Content-Type': audio.type || 'audio/webm'
		},
		body: await audio.arrayBuffer()
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Deepgram error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as {
		results?: { channels?: { alternatives?: { transcript: string }[] }[] }[];
	};
	const transcript = data.results?.[0]?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
	return { text: transcript };
}

async function elevenLabsSTT(audio: Blob, env: AppEnv): Promise<{ text: string }> {
	if (!env.ELEVENLABS_API_KEY) throw new Error('Missing ELEVENLABS_API_KEY');
	const model = env.ELEVENLABS_STT_MODEL;
	const form = new FormData();
	form.append('file', new File([audio], 'audio.webm', { type: audio.type || 'audio/webm' }));
	form.append('model_id', model);
	const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
		method: 'POST',
		headers: {
			'xi-api-key': env.ELEVENLABS_API_KEY
		},
		body: form
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ElevenLabs STT error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as { text?: string };
	return { text: data.text ?? '' };
}
