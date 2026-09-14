import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryIdempotent, isTransientError } from '../shared/retry.ts';
import { readLiveDraft, saveLiveDraft, clearLiveDraft, persistLiveSegment } from '../src/lib/live-session.ts';
import { mergeMeetingMaps, flattenMap } from '../shared/meeting-map.ts';
import { layoutGraph } from '../src/lib/graph-layout.ts';
import { createProgressiveMap } from '../src/lib/progressive-map.ts';

const node = (id, extras = {}) => ({ id, title: id, summary: id, ...extras });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) {
	for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(5); }
	assert.fail('Timed out waiting for test condition');
}

test('transient D1 writes retry with backoff, but permanent SQL errors do not', async () => {
	let attempts = 0;
	const delays = [];
	assert.equal(await retryIdempotent(async () => {
		if (++attempts < 3) throw new Error('D1_ERROR: Network connection lost.');
		return 'saved';
	}, async (ms) => { delays.push(ms); }), 'saved');
	assert.equal(attempts, 3);
	assert.ok(delays[1] > delays[0]);
	attempts = 0;
	await assert.rejects(retryIdempotent(async () => { attempts++; throw new Error('D1_ERROR: no such table'); }, async () => {}), /no such table/);
	assert.equal(attempts, 1);
	assert.ok(isTransientError(new Error('D1_ERROR', { cause: new Error('Network connection lost') })));
});

test('persistent outages stop after a bounded number of retries', async () => {
	let attempts = 0;
	await assert.rejects(retryIdempotent(async () => { attempts++; throw new Error('Network connection lost'); }, async () => {}));
	assert.equal(attempts, 4);
});

test('recognized text survives failed persistence and keeps the same ID on retry', async () => {
	const segment = { id: crypto.randomUUID(), meeting_id: crypto.randomUUID(), segment_index: 0, text: 'A decision we must not lose.', created_at: new Date().toISOString(), saved: false };
	const originalId = segment.id;
	await assert.rejects(persistLiveSegment(segment, async () => { throw new Error('D1 offline'); }));
	assert.equal(segment.saved, false);
	assert.equal(segment.text, 'A decision we must not lose.');
	await persistLiveSegment(segment, async (request) => assert.equal(request.id, originalId));
	assert.equal(segment.saved, true);
});

test('draft recovery survives a reload, tolerates blocked storage, and clears explicitly', () => {
	const values = new Map();
	const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
	const draft = { meetingId: crypto.randomUUID(), modelId: 'model', segments: [] };
	assert.equal(saveLiveDraft(storage, draft), true);
	assert.deepEqual(readLiveDraft(storage), draft);
	clearLiveDraft(storage);
	assert.equal(readLiveDraft(storage), null);
	assert.equal(saveLiveDraft({ setItem() { throw new Error('Quota exceeded'); } }, draft), false);
	assert.equal(readLiveDraft({ getItem() { return '{corrupt'; } }), null);
});

test('incremental map updates preserve topics, decisions and cross-update edges', () => {
	const result = mergeMeetingMaps({ nodes: [node('a', { decisions: ['Approved'] })], edges: [] }, {
		nodes: [node('a', { summary: 'Updated', actions: ['Follow up'] }), node('b')],
		edges: [{ source: 'a', target: 'b', label: 'Led to' }, { source: 'missing', target: 'b' }]
	});
	assert.equal(result.nodes.length, 2);
	assert.deepEqual(result.nodes[0].decisions, ['Approved']);
	assert.deepEqual(result.nodes[0].actions, ['Follow up']);
	assert.equal(result.edges.length, 1);
	const next = mergeMeetingMaps(result, { nodes: [node('c')], edges: [{ source: 'b', target: 'c', label: 'Next' }] });
	assert.equal(next.edges.length, 2);
});

test('legacy nested maps, cycles and disconnected topics remain visible', () => {
	const legacy = flattenMap({ nodes: [node('root', { children: [node('child')] })] });
	assert.deepEqual(legacy.edges, [{ source: 'root', target: 'child', label: 'Includes' }]);
	const graph = layoutGraph({ nodes: [node('a'), node('b'), node('isolated')], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }] });
	assert.equal(graph.nodes.length, 3);
	assert.equal(graph.edges.length, 2);
	assert.ok(graph.edges.every((edge) => !edge.path.includes('NaN')));
});

test('live analysis waits for sufficient speech and serializes updates without losing incoming text', async () => {
	let text = 'short';
	let map = { nodes: [], edges: [] };
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	const calls = [];
	let busy = false;
	const controller = createProgressiveMap({
		transcript: () => text, map: () => map, delay: 1,
		request: async (delta) => {
			calls.push(delta);
			if (calls.length === 1) await gate;
			return { nodes: [node(String(calls.length))], edges: [] };
		}, onMap: (next) => { map = next; }, onBusy: (value) => { busy = value; }, onError: (error) => { if (error) assert.fail(error); }
	});
	try {
		controller.notify(); await sleep(10); assert.equal(calls.length, 0);
		text = 'a'.repeat(120); controller.notify();
		await waitFor(() => calls.length === 1);
		text += 'b'.repeat(160); controller.notify(); controller.notify();
		await sleep(10); assert.equal(calls.length, 1);
		release(); await waitFor(() => map.nodes.length === 2 && !busy);
		assert.deepEqual(calls, ['a'.repeat(120), 'b'.repeat(160)]);
	} finally { release(); controller.dispose(); }
});

test('a failed preview retains the last map, retries the same delta, and stops on disposal', async () => {
	let map = { nodes: [node('existing')], edges: [] };
	let attempts = 0;
	const errors = [];
	const controller = createProgressiveMap({
		transcript: () => 'speech '.repeat(30), map: () => map, delay: 1,
		request: async () => { if (++attempts === 1) throw new Error('AI unavailable'); return { nodes: [node('new')], edges: [] }; },
		onMap: (next) => { map = next; }, onBusy: () => {}, onError: (error) => errors.push(error)
	});
	controller.notify();
	await waitFor(() => map.nodes.length === 2);
	controller.dispose();
	assert.equal(attempts, 2);
	assert.ok(errors.includes('AI unavailable'));
	assert.equal(map.nodes[0].id, 'existing');
});
