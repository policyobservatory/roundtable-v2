import type { AppEnv } from './env';
import type { STTProvider } from './types';
import { speechLanguageError, type SpeechLanguage } from './speech-settings.ts';

type STTEnv = AppEnv & Pick<Cloudflare.Env, 'AI'>;

export async function transcribeAudio(
	provider: STTProvider,
	audio: Blob,
	env: STTEnv,
	language: SpeechLanguage = 'auto'
): Promise<{ text: string }> {
	const error = speechLanguageError(provider, language);
	if (error) throw new Error(error);
	switch (provider) {
		case 'huggingface':
			return huggingFaceSTT(audio, env);
		case 'deepgram':
			return deepgramSTT(audio, env, language);
		case 'whisper':
			return whisperSTT(audio, env, language);
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

async function deepgramSTT(audio: Blob, env: STTEnv, language: SpeechLanguage): Promise<{ text: string }> {
	if (!env.AI) throw new Error('Missing Workers AI binding (AI) for Deepgram Nova-3');
	const data = await env.AI.run(env.DEEPGRAM_STT_MODEL, {
		audio: {
			body: audio.stream(),
			contentType: audio.type || 'audio/webm'
		},
		smart_format: true,
		...(language === 'auto' ? { detect_language: true } : { language })
	});
	// Workers AI returns the model output directly; results is an object, not an array.
	return { text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '' };
}

async function whisperSTT(audio: Blob, env: STTEnv, language: SpeechLanguage): Promise<{ text: string }> {
	if (!env.AI) throw new Error('Missing Workers AI binding (AI) for Whisper');
	const data = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
		audio: {
			body: audio.stream(),
			contentType: audio.type || 'audio/webm'
		},
		task: 'transcribe',
		// Tagalog conditioning keeps Filipino speech from being decoded as English.
		// Whisper can still emit English words when speakers code-switch; this is not translation.
		...(language === 'auto' ? {} : { language: language === 'fil-en' ? 'tl' : language }),
		vad_filter: true,
		condition_on_previous_text: false
	});
	return { text: data.text ?? '' };
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
