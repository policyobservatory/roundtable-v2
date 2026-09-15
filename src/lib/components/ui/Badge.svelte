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
		default: 'bg-primary text-primary-foreground',
		secondary: 'bg-accent-soft text-accent',
		outline: 'border border-border bg-surface text-foreground',
		destructive: 'bg-red-600 text-white hover:bg-red-700'
	};
</script>

<span class={cn('inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium transition-colors', variants[variant], className)}>
	{@render children()}
</span>
