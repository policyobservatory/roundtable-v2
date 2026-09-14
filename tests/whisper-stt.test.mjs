import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcribeAudio } from '../shared/stt.ts';
import { parseEnv } from '../shared/env.ts';
import { STT_PROVIDERS } from '../src/lib/constants.ts';

test('Cloudflare Whisper is a separate dropdown choice from Hugging Face', () => {
	const whisper = STT_PROVIDERS.find((option) => option.value === 'whisper');
	assert.equal(whisper.defaultModel, '@cf/openai/whisper-large-v3-turbo');
	assert.match(whisper.label, /Cloudflare/);
	assert.ok(STT_PROVIDERS.some((option) => option.value === 'huggingface'));
	assert.equal(STT_PROVIDERS[0].value, 'deepgram');
});

test('streams audio to Cloudflare Whisper without API keys and returns its top-level text', async () => {
	const audio = new Blob(['test recording'], { type: 'audio/webm;codecs=opus' });
	let calls = 0;
	const env = parseEnv({ AI: { async run(model, input) {
		calls++;
		assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
		assert.equal(input.task, 'transcribe');
		assert.equal(input.audio.contentType, audio.type);
		assert.ok(input.audio.body instanceof ReadableStream);
		assert.equal(await new Response(input.audio.body).text(), await audio.text());
		return { text: 'Welcome to the meeting.', word_count: 5 };
	} } });
	assert.deepEqual(await transcribeAudio('whisper', audio, env), { text: 'Welcome to the meeting.' });
	assert.equal(calls, 1);
});

test('Whisper uses the default audio MIME type and handles silence', async () => {
	const env = parseEnv({ AI: { async run(model, input) {
		assert.equal(input.audio.contentType, 'audio/webm');
		return { text: '' };
	} } });
	assert.deepEqual(await transcribeAudio('whisper', new Blob(['audio']), env), { text: '' });
});

test('Whisper reports a missing AI binding', async () => {
	await assert.rejects(transcribeAudio('whisper', new Blob(['audio']), parseEnv({})), /Missing Workers AI binding.*Whisper/);
});

test('Whisper propagates inference errors', async () => {
	const env = parseEnv({ AI: { async run() { throw new Error('Whisper unavailable'); } } });
	await assert.rejects(transcribeAudio('whisper', new Blob(['audio']), env), /Whisper unavailable/);
});
