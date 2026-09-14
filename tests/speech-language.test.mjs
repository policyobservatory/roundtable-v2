import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcribeAudio } from '../shared/stt.ts';
import { parseEnv } from '../shared/env.ts';
import { transcribe } from '../src/lib/api.ts';
import { DEFAULT_SPEECH_LANGUAGE, DEFAULT_STT_PROVIDER, LIVE_AUDIO_CHUNK_MS, isSpeechLanguage, supportsSpeechLanguage } from '../shared/speech-settings.ts';

const audio = () => new Blob(['recording'], { type: 'audio/webm' });

test('new meetings default to a Taglish Whisper preset and longer acoustic context', () => {
	assert.equal(DEFAULT_STT_PROVIDER, 'whisper');
	assert.equal(DEFAULT_SPEECH_LANGUAGE, 'fil-en');
	assert.equal(LIVE_AUDIO_CHUNK_MS, 12000);
	assert.ok(isSpeechLanguage('tl'));
	assert.ok(!isSpeechLanguage('multi'));
	assert.ok(!isSpeechLanguage(''));
});

for (const [preset, hint] of [['fil-en', 'tl'], ['tl', 'tl'], ['en', 'en'], ['auto', undefined]]) {
	test(`Whisper ${preset} sends the correct hint, transcribes without translation and filters silence`, async () => {
		const text = 'Hindi pa approved ang budget. Let’s review it tomorrow.';
		let calls = 0;
		const env = parseEnv({ AI: { async run(model, input) {
			calls++;
			assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
			assert.equal(input.language, hint);
			assert.equal(input.task, 'transcribe');
			assert.equal(input.vad_filter, true);
			assert.equal(input.condition_on_previous_text, false);
			assert.equal(input.initial_prompt, undefined, 'Do not introduce example speech that could be hallucinated');
			return { text };
		} } });
		assert.deepEqual(await transcribeAudio('whisper', audio(), env, preset), { text });
		assert.equal(calls, 1);
	});
}

for (const preset of ['en', 'tl', 'auto']) {
	test(`Nova-3 ${preset} uses explicit language or dominant-language detection`, async () => {
		const env = parseEnv({ AI: { async run(model, input) {
			assert.equal(input.language, preset === 'auto' ? undefined : preset);
			assert.equal(input.detect_language, preset === 'auto' ? true : undefined);
			return { results: { channels: [] } };
		} } });
		await transcribeAudio('deepgram', audio(), env, preset);
	});
}

test('browser client sends its selected language without altering audio or returned speech', async () => {
	const originalFetch = globalThis.fetch;
	const blob = audio();
	globalThis.fetch = async (url, options) => {
		assert.equal(url, '/api/stt/whisper?language=fil-en');
		assert.equal(options.body, blob);
		assert.equal(options.method, 'POST');
		return Response.json({ text: 'Mag-review tayo tomorrow.' });
	};
	try { assert.deepEqual(await transcribe('whisper', blob, 'fil-en'), { text: 'Mag-review tayo tomorrow.' }); }
	finally { globalThis.fetch = originalFetch; }
});

test('unsupported presets cannot silently fall back to an English-centric model', async () => {
	for (const provider of ['deepgram', 'huggingface', 'elevenlabs']) {
		assert.equal(supportsSpeechLanguage(provider, 'fil-en'), false);
		await assert.rejects(transcribeAudio(provider, audio(), parseEnv({ AI: { run() { assert.fail('Must reject before inference'); } } }), 'fil-en'), /not supported/);
		assert.equal(supportsSpeechLanguage(provider, 'auto'), true);
	}
});
