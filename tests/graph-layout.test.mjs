import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutGraph, CARD_WIDTH, CARD_HEIGHT } from '../src/lib/graph-layout.ts';

const node = (id) => ({ id, title: id, summary: `Discuss ${id}`, decisions: ['Keep this decision'], actions: ['Follow up'] });
const positions = (graph) => new Map(graph.nodes.map((item) => [item.node.id, item]));
const edge = (source, target) => ({ source, target, label: 'Leads to' });

for (const view of ['live', 'organized']) {
	test(`${view}: a long chain flows down, never wraps into a snake`, () => {
		const nodes = Array.from({ length: 12 }, (_, i) => node(String(i)));
		const edges = nodes.slice(1).map((item, i) => edge(nodes[i].id, item.id));
		const graph = layoutGraph({ nodes, edges }, view);
		assert.equal(new Set(graph.nodes.map((item) => item.x)).size, 1);
		for (let i = 1; i < graph.nodes.length; i++) assert.ok(graph.nodes[i].y > graph.nodes[i - 1].y + graph.cardHeight);
		assert.ok(graph.edges.every((item) => !item.returning));
	});

	test(`${view}: cycles, missing targets, nested and isolated nodes do not break layout`, () => {
		const graph = layoutGraph({ nodes: [{ ...node('a'), children: [node('b')] }, node('alone')], edges: [edge('b', 'a'), edge('a', 'missing')] }, view);
		assert.equal(graph.nodes.length, 3);
		assert.equal(graph.edges.length, 2);
		assert.equal(graph.edges.filter((item) => item.returning).length, 1);
		assert.ok(graph.edges.every((item) => !/NaN|undefined|Infinity/.test(item.path)));
		for (const { x, y } of graph.nodes) {
			assert.ok(x >= 0 && y >= 0);
			assert.ok(x + CARD_WIDTH <= graph.width);
			assert.ok(y + graph.cardHeight <= graph.height);
		}
		assert.deepEqual(layoutGraph({ nodes: [] }, view).nodes, []);
	});
}

test('document lists reserve space without overlapping cards or disconnecting edges', () => {
	for (const view of ['live', 'organized']) {
		const map = { nodes: ['a', 'b'].map(node), edges: [edge('a', 'b')] };
		const plain = layoutGraph(map, view);
		const withDocuments = layoutGraph(map, view, 132);
		assert.equal(withDocuments.nodes[0].height, plain.nodes[0].height + 132);
		assert.ok(withDocuments.nodes[1].y > withDocuments.nodes[0].y + withDocuments.nodes[0].height);
		assert.ok(withDocuments.edges[0].path.startsWith(`M ${withDocuments.nodes[0].x + CARD_WIDTH / 2} ${withDocuments.nodes[0].y + withDocuments.nodes[0].height}`));
	}
});

test('only cards with documents grow; mixed heights keep arrows attached and rows clear', () => {
	for (const view of ['live', 'organized']) {
		const map = { nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')] };
		const plain = layoutGraph(map, view);
		const graph = layoutGraph(map, view, n => n.id === 'b' ? 70 : 0);
		const p = positions(graph);
		assert.equal(p.get('a').height, plain.cardHeight);
		assert.equal(p.get('b').height, plain.cardHeight + 70);
		assert.equal(p.get('c').height, plain.cardHeight);
		assert.equal(p.get('b').y, positions(plain).get('b').y);
		assert.equal(p.get('c').y, positions(plain).get('c').y + 70);
		for (const item of graph.nodes) assert.ok(item.y + item.height <= graph.height);
		assert.ok(graph.edges[1].path.startsWith(`M ${p.get('b').x + CARD_WIDTH / 2} ${p.get('b').y + p.get('b').height}`));
		assert.ok(graph.edges[2].path.startsWith(`M ${p.get('c').x + CARD_WIDTH} ${p.get('c').y + p.get('c').height / 2}`));
		assert.deepEqual(layoutGraph(map, view, () => 0), plain, 'No reserved document whitespace without results');
	}
});

test('measured topic content determines card height and connector endpoints', () => {
	const map = { nodes: ['a', 'b'].map(node), edges: [edge('a', 'b')] };
	const graph = layoutGraph(map, 'live', n => n.id === 'b' ? 70 : 0, n => n.id === 'a' ? 96 : 120);
	assert.equal(graph.nodes[0].height, 96);
	assert.equal(graph.nodes[1].height, 190);
	assert.ok(graph.nodes[1].y > graph.nodes[0].y + 96);
	assert.ok(graph.edges[0].path.startsWith(`M ${graph.nodes[0].x + CARD_WIDTH / 2} ${graph.nodes[0].y + 96}`));
});

test('organized rows use their tallest card to avoid overlapping the next row', () => {
	const graph = layoutGraph({ nodes: ['root', 'left', 'right', 'end'].map(node), edges: [edge('root', 'left'), edge('root', 'right'), edge('left', 'end')] }, 'organized', n => n.id === 'right' ? 114 : 0);
	const p = positions(graph);
	assert.equal(p.get('left').y, p.get('right').y);
	assert.ok(p.get('end').y > p.get('right').y + p.get('right').height);
});

test('organized view ranks real dependencies, even when input nodes are out of order', () => {
	const map = { nodes: ['end', 'left', 'start', 'right'].map(node), edges: [edge('start', 'left'), edge('start', 'right'), edge('left', 'end'), edge('right', 'end')] };
	const graph = layoutGraph(map, 'organized');
	const p = positions(graph);
	assert.equal(p.get('left').y, p.get('right').y);
	assert.notEqual(p.get('left').x, p.get('right').x);
	for (const { source, target } of map.edges) assert.ok(p.get(target).y > p.get(source).y);
	assert.ok(graph.cardHeight < CARD_HEIGHT, 'Organized cards are more compact');
});

test('live graph keeps existing topic positions stable as the map grows', () => {
	const map = { nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b')] };
	const before = layoutGraph(map, 'live');
	const after = layoutGraph({ nodes: [...map.nodes, node('d')], edges: [...map.edges, edge('b', 'd')] }, 'live');
	assert.deepEqual(after.nodes.slice(0, 3), before.nodes);
	assert.equal(after.width, before.width);
});

test('organized layout bounds wide layers and retains every topic and detail without mutating the map', () => {
	const map = { nodes: ['root', ...Array.from({ length: 10 }, (_, i) => `child-${i}`)].map(node), edges: Array.from({ length: 10 }, (_, i) => edge('root', `child-${i}`)) };
	const original = structuredClone(map);
	const organized = layoutGraph(map, 'organized');
	const live = layoutGraph(map, 'live');
	assert.equal(organized.nodes.length, map.nodes.length);
	assert.equal(organized.edges.length, map.edges.length);
	assert.ok(organized.height < live.height);
	assert.deepEqual(map, original);
	for (const { node: item, y } of organized.nodes) {
		assert.ok(organized.nodes.filter((other) => other.y === y).length <= 3);
		assert.deepEqual(item.decisions, ['Keep this decision']);
		assert.deepEqual(item.actions, ['Follow up']);
	}
	assert.deepEqual(layoutGraph(map, 'organized'), organized, 'Deterministic across renders');
});
