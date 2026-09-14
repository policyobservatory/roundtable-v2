import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireWrangler = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = requireWrangler('miniflare');
const { build } = requireWrangler('esbuild');
const delivery = (body) => ({ body, acknowledgements: 0, retries: [], ack() { this.acknowledgements++; }, retry(options) { this.retries.push(options); } });

test('document queue, outbox, persistence and HTTP integration on real local D1', { timeout: 90000 }, async (t) => {
	const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }',
		compatibilityDate: '2026-09-14', d1Databases: ['DB'], r2Buckets: ['TRANSCRIPTS'] }));
	const originalFetch = globalThis.fetch;
	try {
		const db = await mf.getD1Database('DB');
		for (const name of ['0001_initial.sql', '0002_document_jobs.sql']) {
			const sql = (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
			await db.batch(sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
		}
		const compiled = await build({ entryPoints: ['apps/api/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
		const { app, default: worker } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
		const sent = [];
		const env = { DB: db, TRANSCRIPTS: await mf.getR2Bucket('TRANSCRIPTS'), APP_ORIGIN: '*', DOCUMENT_QUEUE: { async send(body) { sent.push(body); } } };
		const post = (path, body, bindings = env, ctx) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, bindings, ctx);
		const meeting = await (await post('/api/meetings', { transcript: 'Privacy discussion', provider: 'openrouter', model: 'test' })).json();
		let counter = 0;
		const topic = (title) => ({ id: `topic-${++counter}`, title: title ?? `Topic ${counter}`, summary: 'Discuss privacy obligations.' });
		const ensure = async (node, retry = false, bindings = env, id = meeting.id) => {
			const response = await post(`/api/meetings/${id}/references`, { nodes: [node], retry }, bindings);
			assert.equal(response.status, 202);
			return (await response.json()).references[0].reference;
		};
		const read = (id) => db.prepare('SELECT * FROM document_jobs WHERE id = ?').bind(id).first();
		const messageFor = (ref) => delivery({ jobId: ref.id, generation: ref.generation });
		const consume = (msg, bindings = env) => worker.queue({ messages: [msg] }, bindings);
		let searches = 0;
		const successFetch = async (url) => {
			if (new URL(url).pathname.endsWith('/provisions')) {
				searches++;
				return Response.json({ items: [{ meta: { bill_id: 'HB-00058', section_id: 'HB-00058_s33', section_title: 'Privacy duties' }, body: 'Relevant provision text.' }] });
			}
			return Response.json({ title_full: 'Privacy bill', text_as_filed: 'https://example.org/bill.pdf', status: 'Pending' });
		};
		globalThis.fetch = successFetch;

		await t.test('enqueue returns promptly without document fetching; repeated cards reuse one durable job', async () => {
			const node = topic();
			const ref = await ensure(node);
			assert.equal(ref.status, 'queued');
			assert.equal(searches, 0);
			const queuedCount = sent.length;
			assert.equal((await ensure(node)).id, ref.id);
			assert.equal(sent.length, queuedCount);
			const msg = messageFor(ref);
			await consume(msg);
			assert.equal(msg.acknowledgements, 1);
			assert.equal((await read(ref.id)).status, 'ready');
			await consume(messageFor(ref));
			assert.equal(searches, 1, 'Duplicate delivery must not repeat a completed search');
			const restored = await ensure({ ...node, id: 'final-map-new-id' });
			assert.equal(restored.status, 'ready');
			assert.equal(restored.documents[0].source_url, 'https://example.org/bill.pdf');
			const response = await app.request(`/api/meetings/${meeting.id}/references?fingerprints=${ref.fingerprint}`, undefined, env);
			assert.equal(response.headers.get('Cache-Control'), 'no-store');
			assert.equal((await response.json()).references[0].status, 'ready');
		});

		await t.test('ambiguous queue-send acknowledgement leaves recoverable outbox work, never a lost job', async () => {
			const failingEnv = { ...env, DOCUMENT_QUEUE: { async send(body) { sent.push(body); throw new Error('Lost queue acknowledgement'); } } };
			const ref = await ensure(topic(), false, failingEnv);
			assert.equal(ref.status, 'pending');
			await db.prepare('UPDATE document_jobs SET dispatch_after = 0 WHERE id = ?').bind(ref.id).run();
			await worker.scheduled({}, env);
			assert.equal((await read(ref.id)).status, 'queued');
			await consume(messageFor(ref));
			assert.equal((await read(ref.id)).status, 'ready');
		});

		await t.test('simultaneous duplicate deliveries have one lease owner', async () => {
			const ref = await ensure(topic());
			let release;
			let entered;
			const started = new Promise((resolve) => entered = resolve);
			const gate = new Promise((resolve) => release = resolve);
			globalThis.fetch = async (url) => {
				if (new URL(url).pathname.endsWith('/provisions')) { entered(); await gate; }
				return successFetch(url);
			};
			const before = searches;
			const first = consume(messageFor(ref));
			await started;
			const duplicate = messageFor(ref);
			await consume(duplicate);
			assert.equal(duplicate.acknowledgements, 1);
			release(); await first;
			assert.equal(searches, before + 1);
			globalThis.fetch = successFetch;
		});

		await t.test('lost D1 claim acknowledgement does not increment attempts twice or abandon owned work', async () => {
			const ref = await ensure(topic());
			let lost = false;
			const bindings = { ...env, DB: { prepare(sql) {
				const stmt = db.prepare(sql);
				if (!sql.includes('attempts = attempts + 1')) return stmt;
				return { bind(...args) { const bound = stmt.bind(...args); return { async first() {
					const result = await bound.first();
					if (!lost) { lost = true; throw new Error('D1_ERROR: Network connection lost.'); }
					return result;
				} }; } };
			} } };
			await consume(messageFor(ref), bindings);
			const row = await read(ref.id);
			assert.equal(row.status, 'ready');
			assert.equal(row.attempts, 1);
		});

		await t.test('a message is not acknowledged before its result is saved', async () => {
			const ref = await ensure(topic());
			const bindings = { ...env, DB: { prepare(sql) {
				if (sql.includes('documents = ?')) throw new Error('D1_ERROR: Network connection lost.');
				return db.prepare(sql);
			} } };
			const msg = messageFor(ref);
			await consume(msg, bindings);
			assert.equal(msg.acknowledgements, 0);
			assert.equal(msg.retries.length, 1);
			assert.equal((await read(ref.id)).status, 'pending');
			await consume(messageFor(ref));
			assert.equal((await read(ref.id)).status, 'ready');
		});

		await t.test('an expired lease owner cannot overwrite a newer consumer result', async () => {
			const ref = await ensure(topic());
			let release;
			let entered;
			let calls = 0;
			const gate = new Promise((resolve) => release = resolve);
			const started = new Promise((resolve) => entered = resolve);
			globalThis.fetch = async (url) => {
				if (!new URL(url).pathname.endsWith('/provisions')) return Response.json({});
				const first = ++calls === 1;
				if (first) { entered(); await gate; }
				return Response.json({ items: [{ meta: { bill_id: 'HB-1', section_id: 'HB-1_s1' }, body: first ? 'Old result' : 'New result' }] });
			};
			try {
				const old = consume(messageFor(ref));
				await started;
				await db.prepare('UPDATE document_jobs SET lease_until = 0 WHERE id = ?').bind(ref.id).run();
				await consume(messageFor(ref));
				release(); await old;
				assert.equal(JSON.parse((await read(ref.id)).documents)[0].content, 'New result');
			} finally { release(); globalThis.fetch = successFetch; }
		});

		await t.test('HTTP 500 has bounded internal retries and an explicit API retry creates a new generation', async () => {
			const node = topic();
			const ref = await ensure(node);
			globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });
			for (let attempt = 1; attempt <= 4; attempt++) {
				const msg = messageFor(ref);
				await consume(msg);
				assert.equal(msg.acknowledgements, attempt === 4 ? 1 : 0);
				if (attempt < 4) assert.equal(msg.retries[0].delaySeconds, 15 * 2 ** (attempt - 1));
			}
			assert.equal((await read(ref.id)).status, 'error');
			assert.match((await read(ref.id)).error, /HTTP 500/);
			const retried = await ensure(node, true);
			assert.equal(retried.generation, ref.generation + 1);
			assert.equal((await ensure(node, true)).generation, retried.generation, 'Retrying a lost POST acknowledgement must not reset an active job');
			globalThis.fetch = successFetch;
			const before = searches;
			await consume(messageFor(ref));
			assert.equal(searches, before, 'Old generation cannot overwrite a manually retried job');
			await consume(messageFor(retried));
			assert.equal((await read(ref.id)).status, 'ready');
		});

		await t.test('empty matches and permanent failures have different terminal states', async () => {
			const emptyTopic = topic();
			const empty = await ensure(emptyTopic);
			globalThis.fetch = async () => Response.json({ total: 0, items: [] });
			await consume(messageFor(empty));
			assert.equal((await read(empty.id)).status, 'empty');
			const sentBefore = sent.length;
			const cached = await ensure(emptyTopic, true);
			assert.equal(cached.status, 'empty');
			assert.equal(cached.generation, empty.generation);
			assert.equal(sent.length, sentBefore, 'Even an explicit retry must not restart an empty search');
			const bad = await ensure(topic());
			globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
			const msg = messageFor(bad);
			await consume(msg);
			assert.equal((await read(bad.id)).status, 'error');
			assert.equal(msg.retries.length, 0);
			globalThis.fetch = successFetch;
		});

		await t.test('revisions are immutable and both old/new jobs can complete without overwriting each other', async () => {
			const oldNode = topic();
			const old = await ensure(oldNode);
			const changed = await ensure({ ...oldNode, summary: 'Discuss penalties instead.' });
			assert.notEqual(old.id, changed.id);
			await consume(messageFor(changed));
			await consume(messageFor(old));
			assert.equal((await read(old.id)).status, 'ready');
			assert.equal((await read(changed.id)).status, 'ready');
		});

		await t.test('expired processing leases are recovered and exhausted crashed jobs become terminal', async () => {
			const ref = await ensure(topic());
			await db.prepare("UPDATE document_jobs SET status = 'searching', lease_token = 'crashed', lease_until = 0, dispatch_after = 0 WHERE id = ?").bind(ref.id).run();
			await worker.scheduled({}, env);
			await consume(messageFor(ref));
			assert.equal((await read(ref.id)).status, 'ready');
			const exhausted = await ensure(topic());
			await db.prepare("UPDATE document_jobs SET status = 'searching', attempts = 4, lease_until = 0, dispatch_after = 0 WHERE id = ?").bind(exhausted.id).run();
			await worker.scheduled({}, env);
			assert.equal((await read(exhausted.id)).status, 'error');
		});

		await t.test('invalid requests and missing meetings are rejected; deleted meetings cannot be resurrected by queue delivery', async () => {
			assert.equal((await post(`/api/meetings/${meeting.id}/references`, { nodes: Array.from({ length: 21 }, () => topic()) })).status, 400);
			assert.equal((await post(`/api/meetings/${crypto.randomUUID()}/references`, { nodes: [topic()] })).status, 404);
			assert.equal((await app.request(`/api/meetings/${meeting.id}/references?fingerprints=invalid`, undefined, env)).status, 400);
			const other = await (await post('/api/meetings', { transcript: '' })).json();
			const ref = await ensure(topic(), false, env, other.id);
			await app.request(`/api/meetings/${other.id}`, { method: 'DELETE' }, env);
			const before = searches;
			await consume(messageFor(ref));
			assert.equal(await read(ref.id), null);
			assert.equal(searches, before);
		});

		await t.test('final analysis schedules references independently of the browser and without waiting for Policy Observatory', async () => {
			globalThis.fetch = async (url) => {
				assert.ok(String(url).includes('openrouter'), 'Analysis must not directly fetch policy documents');
				return Response.json({ choices: [{ message: { content: JSON.stringify({ title: 'Privacy', summary: 'Privacy discussion', nodes: [topic('Final analysis topic')], edges: [] }) } }] });
			};
			const pending = [];
			const ctx = { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {}, props: {} };
			const res = await post(`/api/meetings/${meeting.id}/analyze`, {}, { ...env, OPENROUTER_API_KEY: 'test-only' }, ctx);
			const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
			assert.equal(events.at(-1).type, 'complete');
			assert.equal(pending.length, 1);
			await Promise.all(pending);
			const map = events.at(-1).map;
			assert.equal((await ensure(map.nodes[0])).status, 'queued');
			globalThis.fetch = successFetch;
		});
	} finally { globalThis.fetch = originalFetch; await mf.dispose(); }
});
