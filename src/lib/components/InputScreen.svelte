<script lang="ts">
	import { MessageSquareText, Mic, Trash2, Loader2 } from '@lucide/svelte';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { AI_PROVIDERS, STT_PROVIDERS } from '$lib/constants';

	let {
		isLoading = false,
		error = '',
		progress,
		savedMeetings = $bindable<Meeting[]>([]),
		onSubmit,
		onStartLive,
		onOpen,
		onDelete
	}: {
		isLoading?: boolean;
		error?: string;
		progress?: { processed: number; total: number } | null;
		savedMeetings?: Meeting[];
		onSubmit: (transcript: string, title: string, provider: AIProvider, model: string) => void;
		onStartLive: () => void;
		onOpen: (m: Meeting) => void;
		onDelete: (id: string) => void;
	} = $props();

	let transcript = $state('');
	let title = $state('');
	let aiProvider = $state<AIProvider>('openrouter');
	let aiModel = $state('openai/gpt-4o-mini');
	let sttProvider = $state<STTProvider>('deepgram');

	function providerDefault(provider: AIProvider) {
		return AI_PROVIDERS.find((p) => p.value === provider)?.defaultModel ?? '';
	}

	$effect(() => {
		aiModel = providerDefault(aiProvider);
	});
</script>

<div class="mx-auto max-w-5xl p-6 md:p-10">
	<header class="mb-10 text-center">
		<h1 class="text-4xl font-bold tracking-tight">Roundtable v2</h1>
		<p class="mt-3 text-zinc-600 dark:text-zinc-400">
			Transcribe, analyze, and chat with meetings on Cloudflare Workers + D1 + R2.
		</p>
	</header>

	<section class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
		<div class="mb-4 flex flex-col gap-4 md:flex-row">
			<div class="flex-1">
				<label for="ai-provider" class="mb-1 block text-sm font-medium">AI Provider</label>
				<select id="ai-provider" bind:value={aiProvider} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
					{#each AI_PROVIDERS as p}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
			<div class="flex-[2]">
				<label for="ai-model" class="mb-1 block text-sm font-medium">Model</label>
				<input id="ai-model" bind:value={aiModel} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
			</div>
			<div class="flex-1">
				<label for="stt-provider" class="mb-1 block text-sm font-medium">STT Provider</label>
				<select id="stt-provider" bind:value={sttProvider} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
					{#each STT_PROVIDERS as p}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
		</div>

		<input bind:value={title} placeholder="Meeting title (optional)" class="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-950" />

		<textarea
			bind:value={transcript}
			placeholder="Paste a transcript here, or use live audio..."
			rows={12}
			class="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
		></textarea>

		{#if error}
			<div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
				{error}
			</div>
		{/if}

		{#if progress}
			<div class="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Analyzed chunk {progress.processed} of {progress.total}
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<button
				disabled={isLoading || !transcript.trim()}
				onclick={() => onSubmit(transcript, title, aiProvider, aiModel)}
				class="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
			>
				{#if isLoading}
					<Loader2 class="h-4 w-4 animate-spin" />
					Analyzing...
				{:else}
					<MessageSquareText class="h-4 w-4" />
					Analyze transcript
				{/if}
			</button>
			<button
				onclick={onStartLive}
				class="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
			>
				<Mic class="h-4 w-4" />
				Live meeting
			</button>
		</div>
	</section>

	{#if savedMeetings.length}
		<section class="mt-10">
			<h2 class="mb-4 text-lg font-semibold">Saved meetings</h2>
			<div class="grid gap-4 md:grid-cols-2">
				{#each savedMeetings as meeting}
					<div class="flex items-start justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
						<button class="text-left" onclick={() => onOpen(meeting)}>
							<div class="font-medium">{meeting.title}</div>
							<div class="mt-1 text-xs text-zinc-500">
								{new Date(meeting.created_at).toLocaleString()} · {meeting.provider} · {meeting.status}
							</div>
						</button>
						<button
							onclick={() => onDelete(meeting.id)}
							class="ml-3 rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
