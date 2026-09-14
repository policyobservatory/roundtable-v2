import type { MeetingMap } from '../../shared/types';
import { flattenMap } from '../../shared/meeting-map.ts';

export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 180;

/** Bounded column layout; cycles/disconnected nodes remain visible and deterministic. */
export function layoutGraph(map: MeetingMap) {
	const flat = flattenMap(map);
	const nodes = flat.nodes.map((node, index) => ({
		node, x: 60 + (index % 3) * 370, y: 60 + Math.floor(index / 3) * 270
	}));
	const positions = new Map(nodes.map((item) => [item.node.id, item]));
	const edges = flat.edges.flatMap((edge) => {
		const from = positions.get(edge.source);
		const to = positions.get(edge.target);
		if (!from || !to || from === to) return [];
		const sameRow = from.y === to.y;
		const x1 = sameRow ? from.x + CARD_WIDTH : from.x + CARD_WIDTH / 2;
		const y1 = sameRow ? from.y + CARD_HEIGHT / 2 : from.y + CARD_HEIGHT;
		const x2 = sameRow ? to.x : to.x + CARD_WIDTH / 2;
		const y2 = sameRow ? to.y + CARD_HEIGHT / 2 : to.y;
		const path = sameRow
			? `M ${x1} ${y1} C ${x1 + 45} ${y1 - 35}, ${x2 - 45} ${y2 - 35}, ${x2} ${y2}`
			: `M ${x1} ${y1} C ${x1} ${y1 + 55}, ${x2} ${y2 - 55}, ${x2} ${y2}`;
		return [{ ...edge, path, x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 12 }];
	});
	return { nodes, edges, width: Math.max(400, Math.min(3, nodes.length) * 370 + 30), height: Math.max(350, Math.ceil(nodes.length / 3) * 270 + 30) };
}
