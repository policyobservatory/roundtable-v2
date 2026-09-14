import { referencePending, referenceRevision, type DocumentReference, type ReferenceAssignment, type ReferenceTopic } from '../../shared/document-references.ts';

interface Options {
	ensure: (nodes: ReferenceTopic[], retry: boolean, signal: AbortSignal) => Promise<ReferenceAssignment[]>;
	poll: (fingerprints: string[], signal: AbortSignal) => Promise<DocumentReference[]>;
	onChange: (references: Record<string, DocumentReference>) => void;
	onError: (message: string) => void;
	debounceMs?: number;
	pollMs?: number;
	errorDelayMs?: number;
}

/** Independent of STT/preview. Records are keyed by content revision, never by mutable card ID. */
export function createDocumentReferences(options: Options) {
	const records = new Map<string, DocumentReference>();
	let topics = new Map<string, ReferenceTopic>();
	const retryRevisions = new Set<string>();
	const abort = new AbortController();
	let disposed = false;
	let submitting = false;
	let polling = false;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	const delay = options.debounceMs ?? 2000;
	const pollDelay = options.pollMs ?? 3000;
	const errorDelay = options.errorDelayMs ?? 30000;
	const missing = () => [...topics].filter(([revision]) => !records.has(revision) || retryRevisions.has(revision));
	const pending = () => [...topics.keys()].map((revision) => records.get(revision)).filter(referencePending) as DocumentReference[];

	function store(revision: string, reference: DocumentReference) {
		const previous = records.get(revision);
		if (previous && (previous.generation > reference.generation || (previous.generation === reference.generation && previous.updated_at > reference.updated_at))) return;
		records.set(revision, reference);
	}
	function emit() { if (!disposed) options.onChange(Object.fromEntries(records)); }
	function scheduleSubmit(milliseconds = delay) {
		clearTimeout(debounce);
		if (!disposed && missing().length) debounce = setTimeout(() => { void submit(); }, milliseconds);
	}
	function schedulePoll(milliseconds = pollDelay) {
		clearTimeout(pollTimer);
		if (!disposed && pending().length) pollTimer = setTimeout(() => { void poll(); }, milliseconds);
	}
	async function submit() {
		if (disposed || submitting) return;
		submitting = true;
		let failed = false;
		try {
			while (!disposed) {
				const candidates = missing();
				const retry = candidates.some(([revision]) => retryRevisions.has(revision));
				// Do not reset unrelated failed jobs while retrying a selected card.
				const batch = candidates.filter(([revision]) => retryRevisions.has(revision) === retry).slice(0, 20);
				if (!batch.length) break;
				const result = await options.ensure(batch.map(([, topic]) => topic), retry, abort.signal);
				if (disposed) return;
				for (const entry of result) store(entry.revision, entry.reference);
				for (const [revision] of batch) {
					if (!result.some((entry) => entry.revision === revision)) throw new Error('Some document searches were not accepted. Retrying shortly.');
					retryRevisions.delete(revision);
				}
				options.onError(''); emit(); schedulePoll();
			}
		} catch (error) {
			failed = true;
			if (!disposed) options.onError(error instanceof Error ? error.message : 'Could not queue document searches.');
		} finally {
			submitting = false;
			if (!disposed) scheduleSubmit(failed ? errorDelay : delay);
		}
	}
	async function poll() {
		if (disposed || polling) return;
		polling = true;
		let failed = false;
		try {
			const snapshots = pending();
			for (let i = 0; i < snapshots.length && !disposed; i += 20) {
				const batch = snapshots.slice(i, i + 20);
				const results = await options.poll(batch.map((ref) => ref.fingerprint), abort.signal);
				if (disposed) return;
				for (const reference of results) {
					for (const [revision, old] of records) if (old.fingerprint === reference.fingerprint) store(revision, reference);
				}
				emit();
			}
			options.onError('');
		} catch (error) {
			failed = true;
			if (!disposed) options.onError(error instanceof Error ? error.message : 'Could not refresh document searches.');
		} finally { polling = false; schedulePoll(failed ? errorDelay : pollDelay); }
	}
	return {
		update(nodes: ReferenceTopic[]) {
			if (disposed) return;
			topics = new Map(nodes.map((node) => [referenceRevision(node), { id: node.id, title: node.title, summary: node.summary }]));
			scheduleSubmit();
			if (!polling) schedulePoll();
		},
		retry(topic: ReferenceTopic) {
			if (disposed) return;
			const revision = referenceRevision(topic);
			if (!topics.has(revision)) return;
			retryRevisions.add(revision);
			scheduleSubmit(0);
		},
		refresh() { scheduleSubmit(0); schedulePoll(0); },
		dispose() { disposed = true; clearTimeout(debounce); clearTimeout(pollTimer); abort.abort(); }
	};
}
