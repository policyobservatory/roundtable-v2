<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		children: Snippet;
		variant?: 'default' | 'secondary' | 'outline' | 'destructive';
		class?: string;
	}
	let { children, variant = 'default', class: className = '' }: Props = $props();

	const variants = {
		default: 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200',
		secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-100/80 dark:bg-zinc-800 dark:text-zinc-50',
		outline: 'border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50',
		destructive: 'bg-red-600 text-white hover:bg-red-700'
	};
</script>

<span class={cn('inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium transition-colors', variants[variant], className)}>
	{@render children()}
</span>
