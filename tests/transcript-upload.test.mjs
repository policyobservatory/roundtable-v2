import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	readTranscriptFile,
	TRANSCRIPT_ACCEPT,
	MAX_TRANSCRIPT_FILE_SIZE
} from '../src/lib/transcript-upload.ts';

test('advertises only supported extensions', () => {
	assert.equal(TRANSCRIPT_ACCEPT, '.txt,.md,.srt,.vtt');
});

for (const extension of ['txt', 'md', 'srt', 'vtt', 'TXT']) {
	test(`reads .${extension} files even with an unspecified MIME type`, async () => {
		const text = 'Alice: Hello!\nBob: Let’s begin.';
		assert.equal(await readTranscriptFile(new File([text], `meeting.${extension}`)), text);
	});
}

test('preserves subtitle timestamps and speaker labels', async () => {
	const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Alice>Hello!</v>\n';
	assert.equal(await readTranscriptFile(new File([text], 'meeting.vtt')), text);
});

test('removes a UTF-8 BOM and normalizes line endings', async () => {
	const file = new File(['\ufeffAlice: Hello\r\nBob: Hi\rAlice: Welcome'], 'meeting.txt');
	assert.equal(await readTranscriptFile(file), 'Alice: Hello\nBob: Hi\nAlice: Welcome');
});

for (const name of ['meeting.pdf', 'meeting.docx', 'meeting.txt.exe', 'meeting']) {
	test(`rejects unsupported file ${name} regardless of MIME type`, async () => {
		await assert.rejects(readTranscriptFile(new File(['hello'], name, { type: 'text/plain' })), /Unsupported file type/);
	});
}

for (const text of ['', ' \r\n\t', '\ufeff']) {
	test(`rejects empty content ${JSON.stringify(text)}`, async () => {
		await assert.rejects(readTranscriptFile(new File([text], 'meeting.txt')), /file is empty/);
	});
}

test('rejects files over 5 MB before reading them', async () => {
	await assert.rejects(readTranscriptFile({
		name: 'meeting.txt',
		size: MAX_TRANSCRIPT_FILE_SIZE + 1,
		arrayBuffer() { assert.fail('Oversized files should not be read'); }
	}), /maximum size is 5 MB/);
});

test('allows a file exactly at the size limit', async () => {
	const text = 'a'.repeat(MAX_TRANSCRIPT_FILE_SIZE);
	assert.equal((await readTranscriptFile(new File([text], 'meeting.txt'))).length, text.length);
});

test('rejects invalid UTF-8', async () => {
	await assert.rejects(readTranscriptFile(new File([new Uint8Array([0xff, 0xfe])], 'meeting.txt')), /UTF-8/);
});

test('rejects binary content disguised as text', async () => {
	await assert.rejects(readTranscriptFile(new File(['hello\u0000world'], 'meeting.txt')), /non-text content/);
});

test('reports file read failures', async () => {
	await assert.rejects(readTranscriptFile({
		name: 'meeting.txt',
		size: 10,
		async arrayBuffer() { throw new Error('NotReadableError'); }
	}), /Could not read the file/);
});
