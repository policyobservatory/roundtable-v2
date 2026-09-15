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
	<label for={id} class="block text-xs font-medium text-muted">AI model</label>
	<div class="relative">
		<Sparkles aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
		<select
			{id}
			value={selected.id}
			{disabled}
			aria-describedby={selected.description ? `${id}-description` : undefined}
			onchange={(event) => {
				value = event.currentTarget.value;
				onchange?.(value);
			}}
			class="h-11 w-full cursor-pointer appearance-none truncate rounded border border-border bg-surface pl-10 pr-9 text-sm font-normal text-foreground transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#each AI_MODELS as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
		<ChevronDown aria-hidden="true" class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
	</div>
	{#if selected.description}<p id={`${id}-description`} class="text-xs leading-relaxed text-muted">{selected.description}</p>{/if}
</div>
