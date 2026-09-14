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
		'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50';

	const variants = {
		default: 'bg-zinc-900 text-zinc-50 shadow hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200',
		outline:
			'border border-zinc-300 bg-white shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
		ghost: 'hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
		destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700'
	};

	const sizes = {
		default: 'h-9 px-4 py-2',
		sm: 'h-8 rounded-md px-3 text-xs',
		lg: 'h-11 rounded-md px-8 text-base',
		icon: 'h-9 w-9'
	};
</script>

<button {type} {disabled} {onclick} {title} class={cn(base, variants[variant], sizes[size], className)}>
	{@render children()}
</button>
