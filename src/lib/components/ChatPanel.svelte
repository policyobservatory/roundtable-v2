<script lang="ts">
	import { Send, Loader2 } from '@lucide/svelte';
	import { chat } from '$lib/api';
	import type { AIProvider } from '$shared/types';
	import { AI_MODELS, DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';
	import ModelSelect from '$lib/components/ModelSelect.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';

	let {
		meetingId,
		provider = DEFAULT_AI_MODEL.provider,
		model = DEFAULT_AI_MODEL.model
	}: {
		meetingId: string;
		provider?: AIProvider;
		model?: string;
	} = $props();

	let messages = $state<{ role: string; content: string }[]>([]);
	let input = $state('');
	let docQuery = $state('');
	let loading = $state(false);
	let selectedModelId = $state<string | null>(null);
	// Older meetings may reference a model no longer offered in the dropdown.
	const selectedModel = $derived(selectedModelId === null
		? AI_MODELS.find((option) => option.provider === provider && option.model === model) ?? DEFAULT_AI_MODEL
		: getAIModel(selectedModelId));

	async function submit() {
		if (!input.trim()) return;
		const userMsg = input.trim();
		messages = [...messages, { role: 'user', content: userMsg }];
		input = '';
		loading = true;
		try {
			const reply = await chat({
				messages: messages.slice(-10),
				provider: selectedModel.provider,
				model: selectedModel.model,
				meeting_id: meetingId,
				doc_query: docQuery.trim() || userMsg
			});
			messages = [...messages, { role: 'assistant', content: reply.content }];
		} catch (err: unknown) {
			messages = [...messages, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}` }];
		} finally {
			loading = false;
		}
	}

</script>

<Card class="flex w-96 flex-col border-l border-zinc-200 dark:border-zinc-800">
	<div class="border-b border-zinc-200 p-4 dark:border-zinc-800">
		<h3 class="font-semibold">Chat with meeting</h3>
		<div class="mt-3">
			<ModelSelect id="chat-ai-model" value={selectedModel.id} onchange={(id) => selectedModelId = id} disabled={loading} />
		</div>
		<input bind:value={docQuery} placeholder="Policy document query (optional)" class="mt-2 h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950" />
	</div>

	<div class="flex-1 space-y-3 overflow-auto p-4">
		{#each messages as msg}
			<div class={msg.role === 'user' ? 'ml-6 text-right' : 'mr-6'}>
				<div class={`inline-block rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
					{msg.content}
				</div>
			</div>
		{/each}
		{#if loading}
			<div class="flex items-center gap-2 text-sm text-zinc-500">
				<Loader2 class="h-4 w-4 animate-spin" /> Thinking...
			</div>
		{/if}
	</div>

	<form onsubmit={(e) => { e.preventDefault(); submit(); }} class="border-t border-zinc-200 p-3 dark:border-zinc-800">
		<div class="flex gap-2">
			<Textarea bind:value={input} placeholder="Ask something..." rows={1} class="min-h-0 flex-1 resize-none" />
			<Button type="submit" disabled={loading} size="icon" class="shrink-0">
				<Send class="h-4 w-4" />
			</Button>
		</div>
	</form>
</Card>
