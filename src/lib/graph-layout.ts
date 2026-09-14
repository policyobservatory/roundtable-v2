import type { MeetingMap } from '../../shared/types';
import { flattenMap } from '../../shared/meeting-map.ts';

export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 212;
export const COMPACT_CARD_HEIGHT = 176;
export type GraphView = 'live' | 'organized';
const PADDING = 60;
const COLUMN_GAP = 90;
const ROW_GAP = 110;

/** Live order never snakes or reflows existing topics. Organized view ranks dependencies
 * top-to-bottom, packing branches into at most three columns. Cycles are broken only for
 * positioning: every real edge is retained, with return links routed around the cards. */
export function layoutGraph(map: MeetingMap, view: GraphView = 'live') {
	const flat = flattenMap(map);
	const cardHeight = view === 'organized' ? COMPACT_CARD_HEIGHT : CARD_HEIGHT;
	const rows: typeof flat.nodes[] = [];
	if (view === 'live') {
		rows.push(...flat.nodes.map((node) => [node]));
	} else {
		const remaining = new Set(flat.nodes.map((node) => node.id));
		const byId = new Map(flat.nodes.map((node) => [node.id, node]));
		const outgoing = new Map(flat.nodes.map((node) => [node.id, new Set<string>()]));
		const incoming = new Map(flat.nodes.map((node) => [node.id, 0]));
		const rank = new Map(flat.nodes.map((node) => [node.id, 0]));
		for (const edge of flat.edges) {
			if (edge.source === edge.target || outgoing.get(edge.source)!.has(edge.target)) continue;
			outgoing.get(edge.source)!.add(edge.target);
			incoming.set(edge.target, incoming.get(edge.target)! + 1);
		}
		while (remaining.size) {
			// Deterministic cycle break when there is no zero-in-degree node left.
			const id = [...remaining].find((id) => incoming.get(id) === 0) ?? remaining.values().next().value!;
			remaining.delete(id);
			for (const target of outgoing.get(id)!) {
				if (!remaining.has(target)) continue;
				rank.set(target, Math.max(rank.get(target)!, rank.get(id)! + 1));
				incoming.set(target, incoming.get(target)! - 1);
			}
		}
		const layers = new Map<number, typeof flat.nodes>();
		for (const [id, level] of rank) {
			if (!layers.has(level)) layers.set(level, []);
			layers.get(level)!.push(byId.get(id)!);
		}
		for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
			for (let i = 0; i < layer.length; i += 3) rows.push(layer.slice(i, i + 3));
		}
	}
	const columns = Math.max(1, ...rows.map((row) => row.length));
	const width = PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * COLUMN_GAP;
	const nodes = rows.flatMap((row, index) => row.map((node, column) => ({
		node,
		x: (width - (row.length * CARD_WIDTH + (row.length - 1) * COLUMN_GAP)) / 2 + column * (CARD_WIDTH + COLUMN_GAP),
		y: PADDING + index * (cardHeight + ROW_GAP)
	})));
	const positions = new Map(nodes.map((item) => [item.node.id, item]));
	const edges = flat.edges.flatMap((edge, index) => {
		const from = positions.get(edge.source);
		const to = positions.get(edge.target);
		if (!from || !to || from === to) return [];
		const returning = to.y <= from.y;
		const routed = returning || to.y - from.y > cardHeight + ROW_GAP;
		if (routed) {
			const lane = Math.max(from.x, to.x) + CARD_WIDTH + 24 + (index % 3) * 12;
			const y1 = from.y + cardHeight / 2;
			const y2 = to.y + cardHeight / 2;
			return [{ ...edge, returning, path: `M ${from.x + CARD_WIDTH} ${y1} H ${lane} V ${y2} H ${to.x + CARD_WIDTH}`, x: lane, y: (y1 + y2) / 2 - 8 }];
		}
		const x1 = from.x + CARD_WIDTH / 2;
		const y1 = from.y + cardHeight;
		const x2 = to.x + CARD_WIDTH / 2;
		const y2 = to.y;
		const middle = (y1 + y2) / 2;
		return [{ ...edge, returning, path: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`, x: (x1 + x2) / 2, y: middle - 8 }];
	});
	return { nodes, edges, cardHeight, width, height: Math.max(350, PADDING * 2 + rows.length * (cardHeight + ROW_GAP) - ROW_GAP) };
}
