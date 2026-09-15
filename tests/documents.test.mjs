import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchDocuments, documentApiBase, DocumentApiError } from '../shared/docs.ts';
import { referenceFingerprint, referenceRevision, referenceQuery, safeDocumentUrl, linkedDocuments, referenceLabel, referenceStatusText } from '../shared/document-references.ts';
import { parseEnv } from '../shared/env.ts';

const provision = { meta: { section_id: 'HB-00058_s33', bill_id: 'HB-00058', section_title: 'Powers and duties' }, body: 'The bureau shall perform these duties.' };
const withFetch = async (mock, fn) => { const original = globalThis.fetch; globalThis.fetch = mock; try { await fn(); } finally { globalThis.fetch = original; } };

test('Policy Observatory uses the verified provisions/query/items contract, unauthenticated by default', async () => {
	const calls = [];
	await withFetch(async (input, options) => {
		const url = new URL(input);
		calls.push(url);
		assert.equal(options.headers.Authorization, undefined);
		assert.equal(options.headers['X-API-Key'], undefined);
		assert.ok(options.signal instanceof AbortSignal);
		if (url.pathname.endsWith('/provisions')) {
			assert.equal(url.searchParams.get('query'), 'immigration duties');
			assert.equal(url.searchParams.get('q'), null);
			assert.equal(url.searchParams.get('limit'), '5');
			return Response.json({ total: 1, items: [provision] });
		}
		assert.equal(url.pathname, '/v1/bills/HB-00058');
		return Response.json({ title_full: 'Immigration modernization', text_as_filed: 'https://example.org/bill.pdf', status: 'Pending' });
	}, async () => {
		const docs = await searchDocuments('immigration duties', parseEnv({}));
		assert.equal(docs.length, 1);
		assert.equal(docs[0].content, provision.body);
		assert.equal(docs[0].source_url, 'https://example.org/bill.pdf');
		assert.equal(docs[0].url, 'https://api.policyobservatory.org/v1/provisions/HB-00058_s33');
		assert.equal(docs[0].bill_status, 'Pending');
		assert.equal(calls.length, 2);
	});
});

test('legacy Swagger URL configuration is normalized, optional auth uses X-API-Key', async () => {
	const env = parseEnv({ POLICY_OBSERVATORY_DOCS_URL: 'https://api.policyobservatory.org/v1/docs?q=old', POLICY_OBSERVATORY_API_KEY: 'test-only' });
	assert.equal(documentApiBase(env).href, 'https://api.policyobservatory.org/v1/');
	await withFetch(async (url, options) => {
		assert.equal(options.headers['X-API-Key'], 'test-only');
		assert.equal(new URL(url).searchParams.get('query').length, 500);
		return Response.json({ total: 0, items: [] });
	}, async () => assert.deepEqual(await searchDocuments('a'.repeat(1000), env), []));
});

for (const [status, retryable] of [[500, true], [429, true], [404, false], [401, false]]) {
	test(`HTTP ${status} is an explicit ${retryable ? 'retryable' : 'permanent'} error, not an empty search`, async () => {
		await withFetch(async () => new Response('Internal detail that should not leak', { status }), async () => {
			await assert.rejects(searchDocuments('test', parseEnv({})), (error) => {
				assert.ok(error instanceof DocumentApiError);
				assert.equal(error.retryable, retryable);
				assert.ok(!error.message.includes('Internal detail'));
				return true;
			});
		});
	});
}

test('HTML documentation and malformed search envelopes cannot look like no matches', async () => {
	for (const response of [new Response('<html>Swagger</html>', { headers: { 'Content-Type': 'text/html' } }), Response.json({ results: [] })]) {
		await withFetch(async () => response, async () => await assert.rejects(searchDocuments('test', parseEnv({})), /non-JSON|unexpected search format/));
	}
});

test('external response size is bounded', async () => {
	await withFetch(async () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
		async () => await assert.rejects(searchDocuments('test', parseEnv({})), /size limit/));
});

test('optional bill lookup failure retains provisions; links reject script URLs', async () => {
	await withFetch(async (url) => new URL(url).pathname.endsWith('/provisions') ? Response.json({ items: [provision] }) : new Response('failure', { status: 500 }), async () => {
		const docs = await searchDocuments('test', parseEnv({}));
		assert.equal(docs[0].content, provision.body);
		assert.equal(docs[0].source_url, undefined);
	});
	for (const url of ['javascript:alert(1)', 'data:text/html,attack', '/relative', undefined]) assert.equal(safeDocumentUrl(url), undefined);
	assert.equal(safeDocumentUrl('https://example.org/test'), 'https://example.org/test');
});

test('only successful linkable results contribute document links and counts', () => {
	for (const reference of [undefined, ...['pending', 'queued', 'searching', 'empty', 'error', 'ready'].map((status) => ({ status, documents: [] }))]) {
		assert.equal(referenceLabel(reference), '');
		assert.deepEqual(linkedDocuments(reference), []);
	}
	const unsafe = { id: 'unsafe', url: 'javascript:alert(1)' };
	assert.equal(referenceLabel({ status: 'ready', documents: [unsafe] }), '');
	const valid = { id: 'valid', url: 'https://example.org/provision' };
	assert.deepEqual(linkedDocuments({ status: 'ready', documents: [unsafe, valid] }), [valid]);
	assert.equal(referenceLabel({ status: 'ready', documents: [unsafe, valid] }), '1 related provision');
});

test('document status distinguishes queued, searching, empty, failed and unusable results', () => {
	assert.match(referenceStatusText(), /Waiting to queue/);
	for (const status of ['pending', 'queued']) assert.match(referenceStatusText({ status }), /queued/);
	assert.match(referenceStatusText({ status: 'searching' }), /Searching/);
	assert.match(referenceStatusText({ status: 'pending', error: 'HTTP 500' }), /retrying/);
	assert.match(referenceStatusText({ status: 'error' }), /failed/);
	assert.match(referenceStatusText({ status: 'empty' }), /No matching/);
	assert.match(referenceStatusText({ status: 'ready', documents: [] }), /No usable/);
	assert.equal(referenceStatusText({ status: 'ready', documents: [{ url: 'https://example.org' }] }), '1 related provision');
});

test('content revisions survive card ID/layout changes but change with topic meaning', async () => {
	const a = { id: 'live-id', title: ' Data  privacy ', summary: 'Discuss retention.' };
	const b = { id: 'chunk-0-final-id', title: 'Data privacy', summary: 'Discuss retention.' };
	assert.equal(referenceRevision(a), referenceRevision(b));
	assert.equal(await referenceFingerprint(a), await referenceFingerprint(b));
	assert.notEqual(await referenceFingerprint(a), await referenceFingerprint({ ...b, summary: 'Discuss penalties.' }));
	assert.ok(referenceQuery(a).length <= 500);
});
