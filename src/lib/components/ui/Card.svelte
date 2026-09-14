<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		children: Snippet;
		class?: string;
		id?: string;
	}
	let { children, class: className = '', id }: Props = $props();
</script>

<div {id} class={cn('rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50', className)}>
	{@render children()}
</div>
