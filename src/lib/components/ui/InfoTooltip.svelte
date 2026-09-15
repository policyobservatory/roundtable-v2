<script lang="ts">
	import { Info } from '@lucide/svelte';
	import { onDestroy, tick, type Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
	const id = $props.id();
	let root: HTMLSpanElement;
	let trigger: HTMLButtonElement;
	let tooltip = $state<HTMLSpanElement>();
	let open = $state(false);
	let pinned = false;
	let focused = false;
	let positioned = $state(false);
	let left = $state(12);
	let top = $state(12);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function close() { clearTimeout(hideTimer); open = false; pinned = false; }
	async function show() {
		clearTimeout(hideTimer);
		if (open) return;
		positioned = false;
		open = true;
		await tick();
		if (!open || !tooltip) return;
		const anchor = trigger.getBoundingClientRect();
		const box = tooltip.getBoundingClientRect();
		left = Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12));
		const below = anchor.bottom + 8;
		top = Math.max(12, Math.min(below + box.height <= window.innerHeight - 12 ? below : anchor.top - box.height - 8, window.innerHeight - box.height - 12));
		positioned = true;
	}
	function leave() {
		// Allow the pointer to cross the gap and hover over the explanation.
		hideTimer = setTimeout(() => { if (!focused && !pinned) close(); }, 150);
	}
	onDestroy(() => clearTimeout(hideTimer));
</script>

<svelte:window
	onkeydown={event => { if (event.key === 'Escape' && open) close(); }}
	onpointerdown={event => { if (open && event.target instanceof Node && !root.contains(event.target)) close(); }}
	onresize={close}
	onscroll={close}
/>

<span bind:this={root} role="group" aria-label={label} class="inline-flex" onmouseenter={show} onmouseleave={leave}>
	<button
		bind:this={trigger}
		type="button"
		aria-label={label}
		aria-describedby={open ? id : undefined}
		aria-expanded={open}
		onfocus={() => { focused = true; void show(); }}
		onblur={() => { focused = false; close(); }}
		onclick={() => { if (pinned) close(); else { pinned = true; void show(); } }}
		class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
	>
		<Info class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
	</button>
	{#if open}
		<span
			bind:this={tooltip}
			{id}
			role="tooltip"
			class="fixed z-50 block max-h-[calc(100dvh-24px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded border border-border bg-surface p-3 text-xs font-normal leading-relaxed text-foreground shadow-md"
			style:left={`${left}px`}
			style:top={`${top}px`}
			style:visibility={positioned ? 'visible' : 'hidden'}
		>
			{@render children()}
		</span>
	{/if}
</span>
