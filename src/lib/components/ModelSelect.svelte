<script lang="ts">
	import { ChevronDown, Sparkles } from '@lucide/svelte';
	import { AI_MODELS, DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';

	let {
		id,
		value = $bindable(DEFAULT_AI_MODEL.id),
		disabled = false,
		onchange
	}: {
		id: string;
		value?: string;
		disabled?: boolean;
		onchange?: (id: string) => void;
	} = $props();

	const selected = $derived(getAIModel(value));
</script>

<div class="space-y-2">
	<label for={id} class="block text-xs font-medium text-zinc-500">AI model</label>
	<div class="relative">
		<Sparkles aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
		<select
			{id}
			value={selected.id}
			{disabled}
			aria-describedby={`${id}-description`}
			onchange={(event) => {
				value = event.currentTarget.value;
				onchange?.(value);
			}}
			class="h-11 w-full cursor-pointer appearance-none truncate rounded-lg border border-zinc-300 bg-white pl-10 pr-9 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-500"
		>
			{#each AI_MODELS as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
		<ChevronDown aria-hidden="true" class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
	</div>
	<p id={`${id}-description`} class="text-xs leading-relaxed text-zinc-500">{selected.description}</p>
</div>
