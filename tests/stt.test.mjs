import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcribeAudio } from '../shared/stt.ts';
import { parseEnv } from '../shared/env.ts';
import { STT_PROVIDERS } from '../src/lib/constants.ts';

test('Deepgram defaults to Cloudflare Nova-3 in both server configuration and UI', () => {
	assert.equal(parseEnv({}).DEEPGRAM_STT_MODEL, '@cf/deepgram/nova-3');
	assert.equal(STT_PROVIDERS.find((option) => option.value === 'deepgram').defaultModel, '@cf/deepgram/nova-3');
});

test('streams audio to Nova-3 through the AI binding without API secrets', async () => {
	const audio = new Blob(['test audio bytes'], { type: 'audio/webm;codecs=opus' });
	let calls = 0;
	const AI = {
		async run(model, input) {
			calls++;
			assert.equal(model, '@cf/deepgram/nova-3');
			assert.equal(input.smart_format, true);
			assert.equal(input.audio.contentType, audio.type);
			assert.ok(input.audio.body instanceof ReadableStream);
			assert.equal(await new Response(input.audio.body).text(), await audio.text());
			return { results: { channels: [{ alternatives: [{ transcript: 'Hello, meeting!' }] }] } };
		}
	};
	const env = parseEnv({ AI });
	assert.equal(env.AI, AI, 'Environment parsing must preserve the binding');
	assert.deepEqual(await transcribeAudio('deepgram', audio, env), { text: 'Hello, meeting!' });
	assert.equal(calls, 1);
});

test('defaults to audio/webm when the uploaded blob has no MIME type', async () => {
	const env = parseEnv({ AI: { async run(model, input) {
		assert.equal(input.audio.contentType, 'audio/webm');
		return { results: { channels: [{ alternatives: [{ transcript: '' }] }] } };
	} } });
	assert.deepEqual(await transcribeAudio('deepgram', new Blob(['audio']), env), { text: '' });
});

test('handles an empty transcription result', async () => {
	const env = parseEnv({ AI: { async run() { return { results: { channels: [] } }; } } });
	assert.deepEqual(await transcribeAudio('deepgram', new Blob(['audio']), env), { text: '' });
});

test('reports a missing AI binding', async () => {
	await assert.rejects(transcribeAudio('deepgram', new Blob(['audio']), parseEnv({})), /Missing Workers AI binding/);
});

test('propagates Workers AI inference errors rather than silently returning empty text', async () => {
	const env = parseEnv({ AI: { async run() { throw new Error('Inference unavailable'); } } });
	await assert.rejects(transcribeAudio('deepgram', new Blob(['audio']), env), /Inference unavailable/);
});

test('rejects the obsolete direct Deepgram model setting', () => {
	assert.throws(() => parseEnv({ DEEPGRAM_STT_MODEL: 'nova-2' }), /@cf\/deepgram\/nova-3/);
});
