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

<div {id} class={cn('rounded-md border border-border bg-surface text-foreground', className)}>
	{@render children()}
</div>
