<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	interface Option {
		value: string;
		label: string;
	}
	interface Props {
		value?: string;
		options: Option[];
		label?: string;
		help?: Snippet;
		id?: string;
		disabled?: boolean;
		class?: string;
		onchange?: (value: string) => void;
	}
	let {
		value = $bindable(''),
		options,
		label = '',
		help,
		id = '',
		disabled = false,
		class: className = '',
		onchange
	}: Props = $props();

	function handle(e: Event) {
		const target = e.target as HTMLSelectElement;
		value = target.value;
		onchange?.(target.value);
	}
</script>

{#if label}
	<div class="mb-1 flex items-center gap-1">
		<label for={id} class="text-xs font-medium text-muted">{label}</label>
		{@render help?.()}
	</div>
{/if}
<select
	{id}
	{disabled}
	value={value}
	onchange={handle}
	class={cn(
		'flex h-8 w-full rounded border border-border bg-surface px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50',
		className
	)}
>
	{#each options as opt}
		<option value={opt.value}>{opt.label}</option>
	{/each}
</select>
