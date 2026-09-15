<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		value?: string;
		placeholder?: string;
		rows?: number;
		class?: string;
		disabled?: boolean;
		onkeydown?: (event: KeyboardEvent) => void;
	}
	let { value = $bindable(''), placeholder = '', rows = 4, class: className = '', disabled = false, onkeydown }: Props = $props();
</script>

<textarea
	bind:value
	{rows}
	{placeholder}
	{disabled}
	{onkeydown}
	class={cn(
		'flex w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-500',
		className
	)}
></textarea>
