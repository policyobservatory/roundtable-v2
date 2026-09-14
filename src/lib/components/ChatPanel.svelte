<script lang="ts">
	import { Icon, Send, Loader2 } from '@lucide/svelte';
	import { chat } from '$lib/api';
	import type { AIProvider } from '$lib/types';
	import { AI_PROVIDERS } from '$lib/constants';

	let {
		meetingId,
		provider = $bindable<AIProvider>('openrouter'),
		model = $bindable('openai/gpt-4o-mini')
	}: {
		meetingId: string;
		provider?: AIProvider;
		model?: string;
	} = $props();

	let messages = $state<{ role: string; content: string }[]>([]);
	let input = $state('');
	let docQuery = $state('');
	let loading = $state(false);

	async function submit() {
		if (!input.trim()) return;
		const userMsg = input.trim();
		messages = [...messages, { role: 'user', content: userMsg }];
		input = '';
		loading = true;
		try {
			const reply = await chat({
				messages: messages.slice(-10),
				provider,
				model,
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

<div class="flex w-96 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
	<div class="border-b border-zinc-200 p-4 dark:border-zinc-800">
		<h3 class="font-semibold">Chat with meeting</h3>
		<div class="mt-2 flex gap-2">
			<select bind:value={provider} class="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950">
				{#each AI_PROVIDERS as p}
					<option value={p.value}>{p.label}</option>
				{/each}
			</select>
			<input bind:value={model} placeholder="model" class="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
		</div>
		<input bind:value={docQuery} placeholder="Policy document query (optional)" class="mt-2 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
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
				<Icon icon={Loader2} class="h-4 w-4 animate-spin" /> Thinking...
			</div>
		{/if}
	</div>

	<form onsubmit={(e) => { e.preventDefault(); submit(); }} class="border-t border-zinc-200 p-3 dark:border-zinc-800">
		<div class="flex gap-2">
			<input bind:value={input} placeholder="Ask something..." class="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
			<button type="submit" disabled={loading} class="rounded-lg bg-zinc-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
				<Icon icon={Send} class="h-4 w-4" />
			</button>
		</div>
	</form>
</div>
