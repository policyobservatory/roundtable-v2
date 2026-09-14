<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		children: Snippet;
		for?: string;
		class?: string;
	}
	let { children, for: htmlFor, class: className = '' }: Props = $props();
</script>

<label for={htmlFor} class={cn('text-xs font-medium leading-none text-zinc-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}>
	{@render children()}
</label>
