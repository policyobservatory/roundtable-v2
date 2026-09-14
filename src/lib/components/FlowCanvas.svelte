<script lang="ts">
	import { ZoomIn, ZoomOut, Maximize, X, Loader2 } from '@lucide/svelte';
	import type { MeetingMap } from '$shared/types';
	import { layoutGraph, CARD_WIDTH, CARD_HEIGHT } from '$lib/graph-layout';
	import Button from './ui/Button.svelte';

	let { map, updating = false }: { map: MeetingMap; updating?: boolean } = $props();
	const graph = $derived(layoutGraph(map));
	let scale = $state(0.8);
	let x = $state(0);
	let y = $state(0);
	let selectedId = $state<string | null>(null);
	const selected = $derived(graph.nodes.find((item) => item.node.id === selectedId)?.node);
	let viewport: HTMLDivElement;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let fitted = false;
	const markerId = $props.id();

	function fit() {
		if (!viewport) return;
		scale = Math.min(1, Math.max(0.2, Math.min(viewport.clientWidth / graph.width, viewport.clientHeight / graph.height) * 0.95));
		x = (viewport.clientWidth - graph.width * scale) / 2;
		y = (viewport.clientHeight - graph.height * scale) / 2;
	}
	$effect(() => {
		if (graph.nodes.length && viewport && !fitted) { fitted = true; fit(); }
	});
	function zoom(delta: number) { scale = Math.max(0.2, Math.min(2, scale + delta)); }
	function focusNode(id: string) {
		const item = graph.nodes.find((item) => item.node.id === id);
		if (!item || !viewport) return;
		selectedId = id;
		x = viewport.clientWidth / 2 - (item.x + CARD_WIDTH / 2) * scale;
		y = viewport.clientHeight / 2 - (item.y + CARD_HEIGHT / 2) * scale;
	}
</script>

<div class="flex h-full min-h-96 min-w-0 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
		<div class="flex items-center gap-2 text-sm font-medium">
			Conversation flow <span class="text-xs text-zinc-500">{graph.nodes.length} topics</span>
			{#if updating}<Loader2 class="h-4 w-4 animate-spin text-blue-500" /><span class="text-xs text-blue-500">Updating...</span>{/if}
		</div>
		<div class="flex items-center gap-1">
			<Button variant="ghost" size="icon" title="Zoom out" onclick={() => zoom(-0.1)}><ZoomOut class="h-4 w-4" /></Button>
			<span class="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
			<Button variant="ghost" size="icon" title="Zoom in" onclick={() => zoom(0.1)}><ZoomIn class="h-4 w-4" /></Button>
			<Button variant="ghost" size="icon" title="Fit conversation to view" onclick={fit}><Maximize class="h-4 w-4" /></Button>
		</div>
	</div>
	<div class="relative flex min-h-0 flex-1">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Interactive graph surface implements arrow-key panning and keyboard zoom; topic buttons remain keyboard accessible.) -->
		<div
			bind:this={viewport}
			role="application" aria-label="Conversation flow canvas. Drag to pan, use arrow keys to move, and plus or minus to zoom." tabindex="0"
			class="relative min-h-96 min-w-0 flex-1 touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
			style="background-image: radial-gradient(#a1a1aa55 1px, transparent 1px); background-size: 22px 22px;"
			onpointerdown={(event) => {
				if (event.button !== 0 || (event.target as HTMLElement).closest?.('button')) return;
				dragging = true; lastX = event.clientX; lastY = event.clientY;
				viewport.setPointerCapture(event.pointerId);
			}}
			onpointermove={(event) => {
				if (!dragging) return;
				x += event.clientX - lastX; y += event.clientY - lastY;
				lastX = event.clientX; lastY = event.clientY;
			}}
			onpointerup={() => dragging = false}
			onpointercancel={() => dragging = false}
			onkeydown={(event) => {
				if (event.target !== viewport) return;
				if (event.key === '+') zoom(0.1); else if (event.key === '-') zoom(-0.1);
				else if (event.key === 'ArrowLeft') x += 40; else if (event.key === 'ArrowRight') x -= 40;
				else if (event.key === 'ArrowUp') y += 40; else if (event.key === 'ArrowDown') y -= 40; else return;
				event.preventDefault();
			}}
		>
			{#if !graph.nodes.length}
				<div class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-zinc-500">
					Topics and their connections will appear as the conversation develops. Live analysis starts after about 100 characters and updates roughly every 10 seconds when new speech arrives.
				</div>
			{:else}
				<div class="absolute origin-top-left" style:width={`${graph.width}px`} style:height={`${graph.height}px`} style:transform={`translate(${x}px, ${y}px) scale(${scale})`}>
					<svg class="pointer-events-none absolute inset-0 overflow-visible" width={graph.width} height={graph.height} aria-hidden="true">
						<defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#71717a" /></marker></defs>
						{#each graph.edges as edge}
							<path d={edge.path} stroke="#71717a" stroke-width="1.5" fill="none" marker-end={`url(#${markerId})`} />
							{#if edge.label}<text x={edge.x} y={edge.y} text-anchor="middle" class="fill-zinc-600 text-[10px] dark:fill-zinc-300"><title>{edge.label}</title>{edge.label.length > 28 ? edge.label.slice(0, 27) + '…' : edge.label}</text>{/if}
						{/each}
					</svg>
					{#each graph.nodes as { node, x: nx, y: ny } (node.id)}
						<button class="absolute overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-zinc-900 {selectedId === node.id ? 'border-blue-500' : 'border-zinc-200 dark:border-zinc-700'}"
							style:left={`${nx}px`} style:top={`${ny}px`} style:width={`${CARD_WIDTH}px`} style:height={`${CARD_HEIGHT}px`}
							onclick={() => selectedId = node.id}>
							<h3 class="line-clamp-2 text-sm font-semibold">{node.title}</h3>
							<p class="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{node.summary}</p>
							<p class="mt-3 text-[10px] text-blue-600 dark:text-blue-400">{node.decisions?.length ?? 0} decisions · {node.actions?.length ?? 0} actions · {node.concerns?.length ?? 0} concerns</p>
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if selected}
			<aside class="absolute bottom-0 right-0 top-0 z-10 w-72 max-w-[85%] overflow-auto border-l border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
				<div class="flex items-start justify-between gap-2"><h3 class="font-semibold">{selected.title}</h3><Button variant="ghost" size="icon" title="Close topic details" onclick={() => selectedId = null}><X class="h-4 w-4" /></Button></div>
				<p class="mt-3 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{selected.summary}</p>
				{#each [{ title: 'Decisions', items: selected.decisions }, { title: 'Action items', items: selected.actions }, { title: 'Concerns', items: selected.concerns }] as section}
					{#if section.items?.length}<h4 class="mt-5 text-xs font-semibold">{section.title}</h4><ul class="mt-2 list-disc space-y-2 pl-4 text-xs">{#each section.items as item}<li>{item}</li>{/each}</ul>{/if}
				{/each}
			</aside>
		{/if}
	</div>
	{#if graph.nodes.length}
		<nav aria-label="Conversation topics" class="flex shrink-0 gap-2 overflow-x-auto border-t border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
			{#each graph.nodes as { node }}<button class="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onclick={() => focusNode(node.id)}>{node.title}</button>{/each}
		</nav>
	{/if}
</div>
