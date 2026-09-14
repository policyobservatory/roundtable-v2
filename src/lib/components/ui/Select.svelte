<script lang="ts">
	import { cn } from '$lib/utils';

	interface Option {
		value: string;
		label: string;
	}
	interface Props {
		value?: string;
		options: Option[];
		label?: string;
		id?: string;
		disabled?: boolean;
		class?: string;
		onchange?: (value: string) => void;
	}
	let {
		value = $bindable(''),
		options,
		label = '',
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
	<label for={id} class="mb-1 block text-xs font-medium text-zinc-500">{label}</label>
{/if}
<select
	{id}
	{disabled}
	value={value}
	onchange={handle}
	class={cn(
		'flex h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950',
		className
	)}
>
	{#each options as opt}
		<option value={opt.value}>{opt.label}</option>
	{/each}
</select>
