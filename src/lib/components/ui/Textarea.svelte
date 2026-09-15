<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		value?: string;
		id?: string;
		placeholder?: string;
		rows?: number;
		class?: string;
		disabled?: boolean;
		onkeydown?: (event: KeyboardEvent) => void;
	}
	let { value = $bindable(''), id, placeholder = '', rows = 4, class: className = '', disabled = false, onkeydown }: Props = $props();
</script>

<textarea
	{id}
	bind:value
	{rows}
	{placeholder}
	{disabled}
	{onkeydown}
	class={cn(
		'flex w-full rounded border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
></textarea>
