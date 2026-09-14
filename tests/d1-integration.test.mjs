import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { saveSegment, getSegments, getMeeting } from '../shared/db.ts';
import { readMeetingTranscript } from '../shared/meeting-transcript.ts';

// Use the local Wrangler runtime/compiler, without remote Cloudflare resources.
const requireWrangler = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = requireWrangler('miniflare');
const { build } = requireWrangler('esbuild');

test('local D1 persistence and API reliability', { timeout: 60000 }, async (t) => {
	const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }',
		compatibilityDate: '2026-09-14', d1Databases: ['DB'], r2Buckets: ['TRANSCRIPTS'] }));
	try {
		const db = await mf.getD1Database('DB');
		const bucket = await mf.getR2Bucket('TRANSCRIPTS');
		const sql = (await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
		await db.batch(sql.split(';').map((statement) => statement.trim()).filter(Boolean).map((statement) => db.prepare(statement)));
		const compiled = await build({ entryPoints: ['apps/api/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
		const { app } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
		const env = { DB: db, TRANSCRIPTS: bucket, APP_ORIGIN: '*', AI: { async run() { return { text: 'Speech without D1' }; } } };
		const post = (path, body, bindings = env) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, bindings);
		const created = await post('/api/meetings', { transcript: 'Initial notes', provider: 'openrouter', model: 'test' });
		assert.equal(created.status, 201);
		const { id } = await created.json();
		const segment = { id: crypto.randomUUID(), meeting_id: id, segment_index: 0, text: 'A saved decision', created_at: new Date().toISOString(), status: 'transcribed' };

		await t.test('lost acknowledgement after commit does not duplicate segments or counts', async () => {
			let attempts = 0;
			await saveSegment({ async batch(statements) {
				const result = await db.batch(statements);
				if (++attempts === 1) throw new Error('D1_ERROR: Network connection lost.');
				return result;
			}, prepare: db.prepare.bind(db) }, segment);
			assert.equal(attempts, 2);
			assert.equal((await getSegments(db, id)).length, 1);
			assert.equal((await getMeeting(db, id)).metadata.segmentCount, 1);
		});

		await t.test('same segment can be retried over HTTP without duplicating the transcript', async () => {
			const res = await post('/api/segments', segment);
			assert.equal(res.status, 200);
			const meeting = await getMeeting(db, id);
			assert.equal(await readMeetingTranscript(db, bucket, meeting), 'Initial notes\nA saved decision');
			assert.equal(await (await bucket.get(meeting.transcript_key)).text(), 'Initial notes', 'R2 base is not repeatedly appended');
			const conflict = await post('/api/segments', { ...segment, text: 'Different text' });
			assert.equal(conflict.status, 409);
		});

		await t.test('out-of-order saves are read in transcript order', async () => {
			for (const index of [2, 1]) assert.equal((await post('/api/segments', { ...segment, id: crypto.randomUUID(), segment_index: index, text: `Part ${index}` })).status, 201);
			const res = await app.request(`/api/meetings/${id}`, undefined, env);
			assert.equal(res.status, 200);
			assert.equal((await res.json()).transcript, 'Initial notes\nA saved decision\nPart 1\nPart 2');
		});

		await t.test('legacy R2 transcripts are not doubled by their historical D1 segments', async () => {
			const meeting = await getMeeting(db, id);
			meeting.metadata = {};
			assert.equal(await readMeetingTranscript(db, bucket, meeting), 'Initial notes');
		});

		await t.test('STT does not read or initialize D1', async () => {
			const bindings = { ...env, DB: { prepare() { assert.fail('STT must not touch D1'); } } };
			const res = await app.request('/api/stt/whisper', { method: 'POST', body: new Blob(['audio'], { type: 'audio/webm' }) }, bindings);
			assert.equal(res.status, 200);
			assert.deepEqual(await res.json(), { text: 'Speech without D1' });
		});

		await t.test('speech language travels over HTTP and invalid presets are rejected before inference', async () => {
			let calls = 0;
			const bindings = { ...env, DB: { prepare() { assert.fail('STT must not touch D1'); } }, AI: { async run(model, input) {
				calls++;
				assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
				assert.equal(input.language, 'tl');
				assert.equal(input.task, 'transcribe');
				assert.equal(input.vad_filter, true);
				return { text: 'Hindi pa approved. Review muna.' };
			} } };
			const send = (path) => app.request(path, { method: 'POST', body: new Blob(['audio']) }, bindings);
			const response = await send('/api/stt/whisper?language=fil-en');
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { text: 'Hindi pa approved. Review muna.' });
			for (const path of ['/api/stt/whisper?language=invalid', '/api/stt/whisper?language=', '/api/stt/deepgram?language=fil-en', '/api/stt/huggingface?language=tl']) {
				const bad = await send(path);
				assert.equal(bad.status, 400);
				assert.ok((await bad.json()).error);
			}
			assert.equal(calls, 1);
		});

		await t.test('live preview bypasses D1; final analysis streams and saves a graph with details', async () => {
			const originalFetch = globalThis.fetch;
			const graph = { title: 'Planning', summary: 'Planning work', nodes: [
				{ id: 'proposal', title: 'Proposal', summary: 'Discussed proposal', decisions: ['Approved'], actions: ['Follow up'], concerns: [] },
				{ id: 'budget', title: 'Budget', summary: 'Discussed budget', decisions: [], actions: [], concerns: ['Cost'] }
			], edges: [{ source: 'proposal', target: 'budget', label: 'Requires funding' }] };
			globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(graph) } }] });
			try {
				const noDB = { ...env, OPENROUTER_API_KEY: 'test-only', DB: { prepare() { assert.fail('Live preview must not touch D1'); } } };
				const preview = await post('/api/live-map', { text: 'Discussed a proposal and its budget.', previous: { nodes: [], edges: [] }, provider: 'openrouter', model: 'test' }, noDB);
				assert.equal(preview.status, 200);
				assert.equal((await preview.json()).edges[0].label, 'Requires funding');
				for (let i = 0; i < 2; i++) {
					const response = await post(`/api/meetings/${id}/analyze`, {}, { ...env, OPENROUTER_API_KEY: 'test-only' });
					assert.equal(response.status, 200);
					const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
					assert.equal(events.at(-1).type, 'complete');
					assert.deepEqual(events.at(-1).map.nodes[0].decisions, ['Approved']);
				}
				assert.equal((await getMeeting(db, id)).status, 'completed');
				assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM analysis_chunks WHERE meeting_id = ?').bind(id).first()).count, 1);
			} finally { globalThis.fetch = originalFetch; }
		});

		await t.test('transient database failure is retryable and does not leak a stack trace', async () => {
			const bindings = { ...env, DB: { prepare() { throw new Error('D1_ERROR: Network connection lost.'); } } };
			const res = await app.request('/api/meetings', undefined, bindings);
			assert.equal(res.status, 503);
			const body = await res.json();
			assert.equal(body.retryable, true);
			assert.equal(body.stack, undefined);
		});
	} finally { await mf.dispose(); }
});
