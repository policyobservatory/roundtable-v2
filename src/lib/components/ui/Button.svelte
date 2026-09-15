<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		children: Snippet;
		variant?: 'default' | 'outline' | 'ghost' | 'destructive';
		size?: 'default' | 'sm' | 'lg' | 'icon';
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		onclick?: (e: MouseEvent) => void;
		class?: string;
		title?: string;
	}

	let {
		children,
		variant = 'default',
		size = 'default',
		type = 'button',
		disabled = false,
		onclick,
		class: className = '',
		title
	}: Props = $props();

	const base =
		'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-normal transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50';

	const variants = {
		default: 'bg-primary text-primary-foreground hover:bg-primary/90',
		outline:
			'border border-border bg-transparent text-foreground hover:bg-accent-soft hover:text-accent',
		ghost: 'text-foreground hover:bg-surface-muted hover:text-accent',
		destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700'
	};

	const sizes = {
		default: 'h-9 px-4 py-2',
		sm: 'h-8 px-3 text-xs',
		lg: 'h-11 px-6 text-base',
		icon: 'h-9 w-9'
	};
</script>

<button {type} {disabled} {onclick} {title} class={cn(base, variants[variant], sizes[size], className)}>
	{@render children()}
</button>
