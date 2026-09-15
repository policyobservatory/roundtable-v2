<script lang="ts">
	import { ZoomIn, ZoomOut, Maximize, X, Loader2 } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { MeetingMap } from '$shared/types';
	import { flattenMap } from '$shared/meeting-map';
	import { linkedDocuments, referenceRevision, type DocumentReference } from '$shared/document-references';
	import { createDocumentReferences } from '$lib/document-references';
	import { queueDocumentReferences, pollDocumentReferences } from '$lib/api';
	import TopicReferences from './TopicReferences.svelte';
	import { layoutGraph, CARD_WIDTH, type GraphView } from '$lib/graph-layout';
	import Button from './ui/Button.svelte';

	let { map, meetingId, updating = false, view = $bindable<GraphView>('live'), live = false }: { map: MeetingMap; meetingId?: string; updating?: boolean; view?: GraphView; live?: boolean } = $props();
	let references = $state<Record<string, DocumentReference>>({});
	let documentController = $state<ReturnType<typeof createDocumentReferences> | null>(null);
	$effect(() => {
		const id = meetingId;
		references = {};
		if (!id) { documentController = null; return; }
		const controller = createDocumentReferences({
			ensure: (nodes, retry, signal) => queueDocumentReferences(id, nodes, retry, signal),
			poll: (fingerprints, signal) => pollDocumentReferences(id, fingerprints, signal),
			onChange: (next) => { references = next; },
			onError: () => { /* Optional enrichment stays hidden until documents are available. */ }
		});
		documentController = controller;
		return () => controller.dispose();
	});
	$effect(() => { documentController?.update(flattenMap(map).nodes); });
	let topicHeights = $state<Record<string, number>>({});
	const graph = $derived(layoutGraph(map, view, (node) => {
		const count = meetingId ? linkedDocuments(references[referenceRevision(node)]).length : 0;
		return count ? 48 + Math.min(count, 3) * 22 : 0;
	}, (node) => topicHeights[node.id]));
	function measureTopic(element: HTMLButtonElement, id: string) {
		const measure = () => {
			// offsetHeight is unscaled, so zooming never changes the graph's geometry.
			const height = element.offsetHeight + 2; // Include the outer card border.
			if (height > 2 && topicHeights[id] !== height) topicHeights[id] = height;
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return { destroy: () => observer.disconnect() };
	}
	let followLatest = $state(true);
	let scale = $state(0.8);
	let x = $state(0);
	let y = $state(0);
	let selectedId = $state<string | null>(null);
	const selected = $derived(graph.nodes.find((item) => item.node.id === selectedId)?.node);
	let viewport = $state<HTMLDivElement>();
	let dragging = $state(false);
	let pointerId: number | null = null;
	let suppressClick = false;
	let lastX = 0;
	let lastY = 0;
	let fittedView: GraphView | null = null;
	let lastFollowedPosition = $state<string | null>(null);
	const markerId = $props.id();

	function fit() {
		if (!viewport) return;
		scale = Math.min(1, Math.max(0.2, Math.min(viewport.clientWidth / graph.width, viewport.clientHeight / graph.height) * 0.95));
		x = (viewport.clientWidth - graph.width * scale) / 2;
		y = (viewport.clientHeight - graph.height * scale) / 2;
	}
	$effect(() => {
		if (graph.nodes.length && viewport && fittedView !== view) { fittedView = view; untrack(fit); }
	});
	$effect(() => {
		const latest = graph.nodes.at(-1);
		const position = latest ? `${latest.node.id}:${latest.x}:${latest.y}:${latest.height}` : null;
		if (view === 'live' && followLatest && viewport && latest && lastFollowedPosition !== position) {
			lastFollowedPosition = position;
			untrack(() => panTo(latest));
		}
	});
	function changeView(next: GraphView) { view = next; lastFollowedPosition = null; }
	function panTo(item: typeof graph.nodes[number]) {
		if (!viewport) return;
		x = viewport.clientWidth / 2 - (item.x + CARD_WIDTH / 2) * scale;
		y = viewport.clientHeight / 2 - (item.y + item.height / 2) * scale;
	}
	function zoom(delta: number, anchorX = (viewport?.clientWidth ?? 0) / 2, anchorY = (viewport?.clientHeight ?? 0) / 2) {
		const next = Math.max(0.2, Math.min(2, scale + delta));
		x = anchorX - (anchorX - x) * next / scale;
		y = anchorY - (anchorY - y) * next / scale;
		scale = next;
	}
	function startPan(event: PointerEvent) {
		if (event.button !== 0 || pointerId !== null) return;
		suppressClick = false;
		if ((event.target as Element).closest('[data-document-links]')) return;
		pointerId = event.pointerId;
		lastX = event.clientX; lastY = event.clientY;
	}
	function movePan(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const dx = event.clientX - lastX;
		const dy = event.clientY - lastY;
		// Preserve ordinary topic clicks; capture only once a real drag begins.
		if (!dragging && Math.hypot(dx, dy) < 4) return;
		if (!dragging) {
			dragging = true;
			suppressClick = true;
			followLatest = false;
			viewport?.setPointerCapture(event.pointerId);
		}
		x += dx; y += dy;
		lastX = event.clientX; lastY = event.clientY;
	}
	function endPan(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		dragging = false;
		if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
	}
	function focusNode(id: string) {
		const item = graph.nodes.find((item) => item.node.id === id);
		if (!item || !viewport) return;
		selectedId = id;
		followLatest = false;
		panTo(item);
	}
</script>

<div class="flex h-full min-h-96 min-w-0 flex-col overflow-hidden bg-background">
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
		<div class="flex items-center gap-2 font-serif text-xl">
			Conversation flow <span class="font-sans text-xs text-muted">{graph.nodes.length} topics</span>
			{#if updating}<Loader2 class="h-4 w-4 animate-spin text-accent" /><span class="text-xs text-accent">Updating...</span>{/if}
		</div>
		<div class="flex flex-wrap items-center gap-1">
			<div role="group" aria-label="Canvas view" class="mr-2 flex rounded border border-border p-0.5">
				{#each [{ value: 'organized', label: 'Organized canvas' }, { value: 'live', label: 'Live graph' }] as option}
					<button type="button" aria-pressed={view === option.value} class="rounded px-2 py-1.5 text-xs {view === option.value ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-muted'}" onclick={() => changeView(option.value as GraphView)}>{option.label}</button>
				{/each}
			</div>
			<Button variant="ghost" size="icon" title="Zoom out" onclick={() => zoom(-0.1)}><ZoomOut class="h-4 w-4" /></Button>
			<span class="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
			<Button variant="ghost" size="icon" title="Zoom in" onclick={() => zoom(0.1)}><ZoomIn class="h-4 w-4" /></Button>
			<Button variant="ghost" size="icon" title="Fit conversation to view" onclick={fit}><Maximize class="h-4 w-4" /></Button>
		</div>
	</div>
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted">
		<span>{view === 'organized' ? 'Compact top-to-bottom branches · all topics retained' : 'Top-to-bottom topic discovery order'}{!live ? ' · snapshot, not a replay' : ''}. Dashed arrows return to an earlier topic.</span>
		{#if view === 'live'}<label class="flex items-center gap-1"><input type="checkbox" checked={followLatest} onchange={(event) => {
			followLatest = event.currentTarget.checked;
			lastFollowedPosition = null;
			if (followLatest) selectedId = null;
		}} /> Follow latest topic</label>{/if}
	</div>
	<div class="relative flex min-h-0 flex-1">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Interactive graph surface implements arrow-key panning and keyboard zoom; topic buttons remain keyboard accessible.) -->
		<div
			bind:this={viewport}
			role="application" aria-label="Conversation flow canvas. Drag to pan, use arrow keys to move, and plus or minus to zoom." tabindex="0"
			class="relative min-h-96 min-w-0 flex-1 touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-blue-400 {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
			style="background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px); background-size: 22px 22px;"
			onpointerdown={startPan}
			onpointermove={movePan}
			onpointerup={endPan}
			onpointercancel={endPan}
			onlostpointercapture={endPan}
			onpointerleave={(event) => { if (!dragging) endPan(event); }}
			onclickcapture={(event) => {
				if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
			}}
			onwheel={(event) => {
				if ((event.target as Element).closest('[data-document-links]')) return;
				event.preventDefault();
				followLatest = false;
				const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
				if (event.ctrlKey || event.metaKey) {
					const rect = event.currentTarget.getBoundingClientRect();
					zoom(-event.deltaY * unit * 0.005, event.clientX - rect.left, event.clientY - rect.top);
				} else {
					x -= (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
					y -= (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
				}
			}}
			onkeydown={(event) => {
				if (event.target !== viewport) return;
				if (event.key === '+') zoom(0.1); else if (event.key === '-') zoom(-0.1);
				else if (event.key === 'ArrowLeft') x += 40; else if (event.key === 'ArrowRight') x -= 40;
				else if (event.key === 'ArrowUp') y += 40; else if (event.key === 'ArrowDown') y -= 40; else return;
				followLatest = false;
				event.preventDefault();
			}}
		>
			{#if !graph.nodes.length}
				<div class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
					{#if live}Topics and their connections will appear as the conversation develops. Live analysis starts after about 100 characters and updates roughly every 10 seconds when new speech arrives.{:else}No topics are available yet. Analyze a transcript to build the canvas.{/if}
				</div>
			{:else}
				<div class="absolute origin-top-left" style:width={`${graph.width}px`} style:height={`${graph.height}px`} style:transform={`translate(${x}px, ${y}px) scale(${scale})`}>
					<svg class="pointer-events-none absolute inset-0 overflow-visible" width={graph.width} height={graph.height} aria-hidden="true">
						<defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--canvas-edge)" /></marker></defs>
						{#each graph.edges as edge}
							<path d={edge.path} stroke="var(--canvas-edge)" stroke-width="1.5" stroke-dasharray={edge.returning ? '6 4' : undefined} stroke-linejoin="round" fill="none" marker-end={`url(#${markerId})`} />
							{#if edge.label}<text x={edge.x} y={edge.y} text-anchor="middle" class="fill-muted text-[10px]"><title>{edge.label}</title>{edge.label.length > 28 ? edge.label.slice(0, 27) + '…' : edge.label}</text>{/if}
						{/each}
					</svg>
					{#each graph.nodes as { node, x: nx, y: ny, height, documentSpace } (node.id)}
						<div data-topic-card={node.id} class="absolute overflow-hidden rounded-md border bg-surface {selectedId === node.id ? 'border-accent ring-1 ring-accent' : 'border-border'}"
							style:left={`${nx}px`} style:top={`${ny}px`} style:width={`${CARD_WIDTH}px`} style:height={`${height}px`}>
							<button use:measureTopic={node.id} class="flex w-full cursor-inherit flex-col items-start overflow-hidden p-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" onclick={() => { selectedId = node.id; followLatest = false; }}>
								<h3 class="line-clamp-2 font-serif text-xl font-normal leading-tight">{node.title}</h3>
								<p class="mt-2 text-xs leading-relaxed text-muted {view === 'organized' ? 'line-clamp-2' : 'line-clamp-3'}">{node.summary}</p>
								<p class="mt-2 text-[10px] font-medium text-accent">{node.decisions?.length ?? 0} decisions · {node.actions?.length ?? 0} actions · {node.concerns?.length ?? 0} concerns</p>
							</button>
							{#if documentSpace}<div data-document-links class="cursor-auto overflow-y-auto overscroll-contain border-t border-border bg-surface-muted p-3" style:height={`${documentSpace}px`}>
								<TopicReferences reference={references[referenceRevision(node)]} compact />
							</div>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
		{#if selected}
			<aside class="absolute bottom-0 right-0 top-0 z-10 w-72 max-w-[85%] overflow-auto border-l border-border bg-surface p-4 shadow-lg">
				<div class="flex items-start justify-between gap-2"><h3 class="font-serif text-2xl font-normal leading-tight">{selected.title}</h3><Button variant="ghost" size="icon" title="Close topic details" onclick={() => selectedId = null}><X class="h-4 w-4" /></Button></div>
				<p class="mt-3 whitespace-pre-wrap text-sm text-muted">{selected.summary}</p>
				{#each [{ title: 'Decisions', items: selected.decisions }, { title: 'Action items', items: selected.actions }, { title: 'Concerns', items: selected.concerns }] as section}
					{#if section.items?.length}<h4 class="mt-5 text-xs font-semibold">{section.title}</h4><ul class="mt-2 list-disc space-y-2 pl-4 text-xs">{#each section.items as item}<li>{item}</li>{/each}</ul>{/if}
				{/each}
				{#if meetingId}<TopicReferences reference={references[referenceRevision(selected)]} />{/if}
			</aside>
		{/if}
	</div>
	{#if graph.nodes.length}
		<nav aria-label="Conversation topics" class="flex shrink-0 gap-2 overflow-x-auto border-t border-border bg-surface p-2">
			{#each graph.nodes as { node }}<button class="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-accent-soft hover:text-accent" onclick={() => focusNode(node.id)}>{node.title}</button>{/each}
		</nav>
	{/if}
</div>
