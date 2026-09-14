import { z } from 'zod';
import type { MeetingMap, MeetingNode } from './types';

export const mapNodeSchema = z.object({
	id: z.string().min(1).max(150), title: z.string().max(300), summary: z.string().max(3000),
	decisions: z.array(z.string().max(1000)).max(30).default([]),
	actions: z.array(z.string().max(1000)).max(30).default([]),
	concerns: z.array(z.string().max(1000)).max(30).default([])
});
export const mapEdgeSchema = z.object({ source: z.string(), target: z.string(), label: z.string().max(300).optional() });
export const liveMapSchema = z.object({ nodes: z.array(mapNodeSchema).max(100), edges: z.array(mapEdgeSchema).max(300).default([]) });

/** Also adapts legacy nested maps into graph nodes without discarding their parent links. */
export function flattenMap(map: MeetingMap): Required<MeetingMap> {
	const nodes = new Map<string, MeetingNode>();
	const edges = [...(map.edges ?? [])];
	function visit(node: MeetingNode, parent?: string) {
		if (nodes.has(node.id)) return;
		const { children, ...flat } = node;
		nodes.set(node.id, flat);
		if (parent) edges.push({ source: parent, target: node.id, label: 'Includes' });
		children?.forEach((child) => visit(child, node.id));
	}
	map.nodes.forEach((node) => visit(node));
	return { nodes: [...nodes.values()], edges: edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)) };
}

export function mergeMeetingMaps(previous: MeetingMap, update: MeetingMap): Required<MeetingMap> {
	const before = flattenMap(previous);
	const after = flattenMap(update);
	const nodes = new Map(before.nodes.map((node) => [node.id, node]));
	for (const node of after.nodes) {
		const old = nodes.get(node.id);
		nodes.set(node.id, { ...old, ...node,
			decisions: [...new Set([...(old?.decisions ?? []), ...(node.decisions ?? [])])],
			actions: [...new Set([...(old?.actions ?? []), ...(node.actions ?? [])])],
			concerns: [...new Set([...(old?.concerns ?? []), ...(node.concerns ?? [])])]
		});
	}
	const edges = new Map<string, NonNullable<MeetingMap['edges']>[number]>();
	for (const edge of [...before.edges, ...(update.edges ?? []), ...after.edges]) {
		if (edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target)) edges.set(`${edge.source}\0${edge.target}`, edge);
	}
	return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
