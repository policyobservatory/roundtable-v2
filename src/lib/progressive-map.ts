import type { MeetingMap } from '../../shared/types';
import { mergeMeetingMaps } from '../../shared/meeting-map.ts';

export function createProgressiveMap(options: {
	transcript: () => string;
	map: () => MeetingMap;
	request: (text: string, previous: MeetingMap, signal: AbortSignal) => Promise<MeetingMap>;
	onMap: (map: MeetingMap) => void;
	onBusy: (busy: boolean) => void;
	onError: (message: string) => void;
	delay?: number;
}) {
	let cursor = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending = false;
	let stopped = false;
	const controller = new AbortController();

	function notify() {
		if (stopped || pending || timer || options.transcript().length - cursor < (cursor ? 150 : 100)) return;
		timer = setTimeout(() => { timer = undefined; void run(); }, options.delay ?? 10000);
	}
	async function run() {
		if (stopped || pending) return;
		const text = options.transcript().slice(cursor, cursor + 6000);
		if (!text.trim()) return;
		pending = true;
		options.onBusy(true);
		try {
			// Bound model context, while retaining the complete map in the client.
			const nodes = options.map().nodes.slice(-40);
			const ids = new Set(nodes.map((node) => node.id));
			const previous = { nodes, edges: options.map().edges?.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(-100) ?? [] };
			const update = await options.request(text, previous, controller.signal);
			if (stopped) return;
			options.onMap(mergeMeetingMaps(options.map(), update));
			cursor += text.length;
			options.onError('');
		} catch (err) {
			if (!stopped) options.onError(err instanceof Error ? err.message : String(err));
		} finally {
			pending = false;
			if (!stopped) { options.onBusy(false); notify(); }
		}
	}
	return {
		notify,
		dispose() { stopped = true; clearTimeout(timer); controller.abort(); options.onBusy(false); }
	};
}
