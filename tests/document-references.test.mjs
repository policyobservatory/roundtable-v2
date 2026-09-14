import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentReferences } from '../src/lib/document-references.ts';
import { referenceRevision } from '../shared/document-references.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(5); } assert.fail('Timed out waiting for controller'); }
const node = (id, summary = 'Discuss policy.') => ({ id, title: `Topic ${id}`, summary });
const reference = (n, status = 'queued', generation = 0) => ({ id: n.id, fingerprint: n.id, generation, status, documents: [], updated_at: '2026-09-14T00:00:00.000Z' });
const assignments = (nodes, status = 'queued', generation = 0) => nodes.map((n) => ({ revision: referenceRevision(n), reference: reference(n, status, generation) }));
const timings = { debounceMs: 5, pollMs: 5, errorDelayMs: 10 };

test('debounces changing topics, polls pending work, then stops polling terminal results', async () => {
	const requests = [];
	let polls = 0;
	let state = {};
	const controller = createDocumentReferences({ ...timings,
		ensure: async (nodes) => { requests.push(nodes); return assignments(nodes); },
		poll: async (ids) => { polls++; return ids.map((id) => reference(node(id), 'ready')); },
		onChange: (next) => state = next, onError: (message) => assert.equal(message, '')
	});
	try {
		controller.update([node('a', 'Initial thought')]);
		const latest = node('a', 'Settled topic');
		controller.update([latest]);
		await waitFor(() => state[referenceRevision(latest)]?.status === 'ready');
		assert.equal(requests.length, 1);
		assert.equal(requests[0][0].summary, 'Settled topic');
		const completedPolls = polls;
		controller.update([latest]);
		await sleep(30);
		assert.equal(polls, completedPolls);
		assert.equal(requests.length, 1, 'View/map rerenders do not resubmit unchanged topics');
	} finally { controller.dispose(); }
});

test('late responses attach only to their content revision, not the current card ID', async () => {
	let release;
	const gate = new Promise((resolve) => release = resolve);
	let calls = 0;
	let state = {};
	const first = node('same-id', 'Old meaning');
	const second = node('same-id', 'New meaning');
	const controller = createDocumentReferences({ ...timings,
		ensure: async (nodes) => { if (++calls === 1) await gate; return assignments(nodes, 'ready'); },
		poll: async () => assert.fail('Ready results must not poll'),
		onChange: (next) => state = next, onError: () => {}
	});
	try {
		controller.update([first]); await waitFor(() => calls === 1);
		controller.update([second]); release();
		await waitFor(() => state[referenceRevision(second)]?.status === 'ready');
		assert.notEqual(referenceRevision(first), referenceRevision(second));
		assert.equal(calls, 2);
		assert.ok(state[referenceRevision(first)]);
		assert.ok(state[referenceRevision(second)]);
	} finally { release(); controller.dispose(); }
});

test('queue/poll transport errors back off and recover without losing accepted work', async () => {
	let sends = 0;
	let polls = 0;
	let state = {};
	const errors = [];
	const topic = node('a');
	const controller = createDocumentReferences({ ...timings,
		ensure: async (nodes) => { if (++sends === 1) throw new Error('Queue unavailable'); return assignments(nodes); },
		poll: async () => { if (++polls === 1) throw new Error('Status unavailable'); return [reference(topic, 'empty')]; },
		onChange: (next) => state = next, onError: (message) => errors.push(message)
	});
	try {
		controller.update([topic]);
		await waitFor(() => state[referenceRevision(topic)]?.status === 'empty');
		assert.equal(sends, 2);
		assert.equal(polls, 2);
		assert.ok(errors.includes('Queue unavailable'));
		assert.ok(errors.includes('Status unavailable'));
	} finally { controller.dispose(); }
});

test('requests are bounded to 20 cards and identical content under another ID is reused', async () => {
	const sizes = [];
	let state = {};
	const nodes = Array.from({ length: 25 }, (_, i) => node(String(i)));
	const controller = createDocumentReferences({ ...timings,
		ensure: async (batch) => { sizes.push(batch.length); return assignments(batch, 'ready'); },
		poll: async () => [], onChange: (next) => state = next, onError: () => {}
	});
	try {
		controller.update([...nodes, { ...nodes[0], id: 'final-card-id' }]);
		await waitFor(() => Object.keys(state).length === 25);
		assert.deepEqual(sizes, [20, 5]);
	} finally { controller.dispose(); }
});

test('manual retry generation cannot be overwritten by an older in-flight status response', async () => {
	let release;
	const gate = new Promise((resolve) => release = resolve);
	let polling = false;
	let state = {};
	const topic = node('a');
	const controller = createDocumentReferences({ ...timings,
		ensure: async (nodes, retry) => assignments(nodes, retry ? 'ready' : 'queued', retry ? 1 : 0),
		poll: async () => { polling = true; await gate; return [reference(topic, 'error', 0)]; },
		onChange: (next) => state = next, onError: () => {}
	});
	try {
		controller.update([topic]); await waitFor(() => polling);
		controller.retry(topic);
		await waitFor(() => state[referenceRevision(topic)]?.generation === 1);
		release(); await sleep(20);
		assert.equal(state[referenceRevision(topic)].status, 'ready');
		assert.equal(state[referenceRevision(topic)].generation, 1);
	} finally { release(); controller.dispose(); }
});

test('disposing aborts browser requests and prevents late UI callbacks or more polling', async () => {
	let signal;
	let release;
	const gate = new Promise((resolve) => release = resolve);
	let changes = 0;
	const controller = createDocumentReferences({ ...timings,
		ensure: async (nodes, _retry, requestSignal) => { signal = requestSignal; await gate; return assignments(nodes); },
		poll: async () => assert.fail('Disposed controller must not poll'),
		onChange: () => changes++, onError: () => {}
	});
	controller.update([node('a')]);
	await waitFor(() => signal);
	controller.dispose();
	assert.equal(signal.aborted, true);
	release(); await sleep(20);
	assert.equal(changes, 0);
});
