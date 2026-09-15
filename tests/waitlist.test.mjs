import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireWrangler = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = requireWrangler('miniflare');
const { build } = requireWrangler('esbuild');

test('waitlist POST persists safely to real local D1', { timeout: 60000 }, async t => {
	const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch(){return new Response("test")} }', compatibilityDate: '2026-09-14', d1Databases: ['DB'] }));
	try {
		const db = await mf.getD1Database('DB');
		const sql = (await readFile(new URL('../migrations/0004_waitlists.sql', import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
		await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
		const compiled = await build({ entryPoints: ['apps/api/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
		const { app } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
		const env = { DB: db, APP_ORIGIN: '*' };
		const post = (data, bindings = env) => app.request('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, bindings);
		const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM waitlists').first()).n;

		await t.test('normalizes signup fields and saves contact permission version', async () => {
			const response = await post({ first_name: '  María-José  ', email: '  Staff@Example.org ', industry: 'legislature' });
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.deepEqual(await response.json(), { ok: true });
			const row = await db.prepare('SELECT * FROM waitlists').first();
			assert.equal(row.first_name, 'María-José');
			assert.equal(row.email, 'staff@example.org');
			assert.equal(row.industry, 'legislature');
			assert.equal(row.consent_version, 'launch-discount-v1');
			assert.ok(row.id && Number.isFinite(Date.parse(row.created_at)));
		});
		await t.test('duplicates acknowledge without exposing or overwriting existing subscribers', async () => {
			const response = await post({ first_name: 'Different person', email: 'STAFF@example.org', industry: 'other' });
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { ok: true });
			assert.equal(await count(), 1);
			assert.equal((await db.prepare('SELECT first_name FROM waitlists').first()).first_name, 'María-José');
		});
		await t.test('optional industry accepts omitted, blank, and null values', async () => {
			for (const [i, industry] of [undefined, '', null].entries()) {
				assert.equal((await post({ first_name: 'Ana', email: `optional${i}@example.org`, industry })).status, 200);
				assert.equal((await db.prepare('SELECT industry FROM waitlists WHERE email = ?').bind(`optional${i}@example.org`).first()).industry, null);
			}
		});
		await t.test('invalid bodies, unexpected fields and unknown industries never write', async () => {
			const before = await count();
			const valid = { first_name: 'Ana', email: 'new@example.org' };
			for (const body of [null, [], {}, { ...valid, first_name: ' ' }, { ...valid, first_name: 'A'.repeat(81) }, { ...valid, first_name: 'A\nB' }, { ...valid, email: 'invalid' }, { ...valid, email: 'a'.repeat(255) + '@example.org' }, { ...valid, industry: 'unlisted' }, { ...valid, industry: 42 }, { ...valid, created_at: 'forged' }]) {
				assert.equal((await post(body)).status, 400);
			}
			assert.equal(await count(), before);
		});
		await t.test('malformed JSON, wrong content type, and oversized streamed bodies are rejected', async () => {
			assert.equal((await app.request('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, env)).status, 400);
			assert.equal((await app.request('/api/waitlist', { method: 'POST', body: 'first_name=Ana' }, env)).status, 415);
			const raw = new Request('https://example.org/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, duplex: 'half', body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(9000))); controller.close(); } }) });
			assert.equal((await app.fetch(raw, env)).status, 413);
		});
		await t.test('spam trap returns generic acknowledgement without storing the submission', async () => {
			const before = await count();
			assert.deepEqual(await (await post({ first_name: 'Bot', email: 'bot@example.org', website: 'https://spam.example' })).json(), { ok: true });
			assert.equal(await count(), before);
		});
		await t.test('bound parameters preserve text without executing SQL from fields', async () => {
			const name = "O'Brien'); DROP TABLE waitlists; --";
			assert.equal((await post({ first_name: name, email: 'quote@example.org' })).status, 200);
			assert.equal((await db.prepare('SELECT first_name FROM waitlists WHERE email = ?').bind('quote@example.org').first()).first_name, name);
		});
		await t.test('simultaneous submissions share one case-insensitive email identity', async () => {
			const replies = await Promise.all(Array.from({ length: 6 }, () => post({ first_name: 'Sam', email: 'concurrent@example.org' })));
			assert.ok(replies.every(r => r.status === 200));
			assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM waitlists WHERE email = ?').bind('concurrent@example.org').first()).n, 1);
		});
		await t.test('a lost D1 acknowledgement retries without inserting twice', async () => {
			let attempts = 0;
			const flaky = { prepare(sql) { return { bind(...values) { return { async run() { const result = await db.prepare(sql).bind(...values).run(); if (++attempts === 1) throw new Error('D1_ERROR: Network connection lost.'); return result; } }; } }; } };
			assert.equal((await post({ first_name: 'Retry', email: 'retry@example.org' }, { ...env, DB: flaky })).status, 200);
			assert.equal(attempts, 2);
			assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM waitlists WHERE email = ?').bind('retry@example.org').first()).n, 1);
		});
		await t.test('D1 failure returns a generic retryable response and logs no submitted details', async () => {
			const originalError = console.error;
			const logs = [];
			console.error = (...args) => logs.push(args.join(' '));
			try {
				const response = await post({ first_name: 'Private', email: 'private@example.org' }, { ...env, DB: { prepare() { throw new Error('private@example.org internal SQL failure'); } } });
				assert.equal(response.status, 503);
				assert.equal(JSON.stringify(await response.json()).includes('private@example.org'), false);
				assert.deepEqual(logs, ['{"event":"waitlist_save_failed"}']);
			} finally { console.error = originalError; }
		});
		await t.test('there is no public subscriber list, update, or delete operation', async () => {
			for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await app.request('/api/waitlist', { method }, env)).status, 405);
		});
	} finally { await mf.dispose(); }
});
