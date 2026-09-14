<script lang="ts">
	import { Loader2, Mic, Trash2, Clock, ChevronRight } from '@lucide/svelte';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { AI_PROVIDERS, STT_PROVIDERS } from '$lib/constants';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { timeAgo } from '$lib/utils';

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
		onSubmit: (transcript: string, provider: AIProvider, model: string) => void;
		onStartLive: () => void;
		onOpen: (m: Meeting) => void;
		onDelete: (id: string) => void;
	} = $props();

	let transcript = $state('');
	let aiProvider = $state<AIProvider>('openrouter');
	let aiModel = $state('openai/gpt-4o-mini');
	let sttProvider = $state<STTProvider>('deepgram');

	function providerDefault(provider: AIProvider) {
		return AI_PROVIDERS.find((p) => p.value === provider)?.defaultModel ?? '';
	}

	$effect(() => {
		aiModel = providerDefault(aiProvider);
	});

	function handleSubmit() {
		if (!transcript.trim()) return;
		onSubmit(transcript, aiProvider, aiModel);
	}

	function nodeCount(meeting: Meeting) {
		const n = meeting.map?.nodes?.length ?? 0;
		return `${n} topic${n !== 1 ? 's' : ''}`;
	}

	const aiOptions = AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));
	const sttOptions = STT_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

	const hasMeetings = savedMeetings.length > 0;
</script>

<div class="min-h-screen px-4 py-12">
	<div class="mx-auto max-w-5xl space-y-10">
		<!-- Header -->
		<div class="space-y-2 text-center">
			<h1 class="text-4xl font-semibold tracking-tight">Roundtable</h1>
			<p class="text-zinc-500">Paste a meeting transcript and visualize it as an interactive map.</p>
		</div>

		<div class={hasMeetings ? 'grid grid-cols-1 gap-8 lg:grid-cols-2' : 'mx-auto max-w-2xl'}>
			<!-- New Meeting -->
			<div class="space-y-4">
				<h2 class="text-lg font-medium">New Meeting</h2>

				<Card class="p-5">
					<div class="space-y-4">
						<Textarea bind:value={transcript} placeholder="Paste your meeting transcript here..." rows={10} class="h-52 resize-y" disabled={isLoading} />

						<div class="flex items-center gap-2">
							<span class="shrink-0 text-xs text-zinc-500">AI Model:</span>
							<Select bind:value={aiProvider} options={aiOptions} disabled={isLoading} class="flex-1" />
							<input bind:value={aiModel} placeholder="model" class="h-8 w-40 rounded-md border border-zinc-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950" disabled={isLoading} />
						</div>

						{#if error}
							<p class="text-sm text-red-600">{error}</p>
						{/if}

						<Button size="lg" class="w-full" onclick={handleSubmit} disabled={isLoading || !transcript.trim()}>
							{#if isLoading}
								<Loader2 class="h-4 w-4 animate-spin" />
								{#if progress && progress.total > 1}
									Analyzing chunk {progress.processed} of {progress.total}...
								{:else}
									Analyzing...
								{/if}
							{:else}
								Map this meeting
							{/if}
						</Button>

						<div class="flex items-center gap-3">
							<div class="flex-1 border-t border-zinc-200"></div>
							<span class="text-xs text-zinc-500">or</span>
							<div class="flex-1 border-t border-zinc-200"></div>
						</div>

						<div class="flex items-center gap-2">
							<span class="shrink-0 text-xs text-zinc-500">Speech-to-Text:</span>
							<Select bind:value={sttProvider} options={sttOptions} disabled={isLoading} class="flex-1" />
						</div>

						<Button variant="outline" size="lg" class="w-full" onclick={onStartLive} disabled={isLoading}>
							<Mic class="h-5 w-5" />
							Start Live Meeting
						</Button>
					</div>
				</Card>
			</div>

			<!-- Past Meetings -->
			{#if hasMeetings}
				<div class="space-y-4">
					<h2 class="text-lg font-medium">Past Meetings</h2>

					<div class="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
						{#each savedMeetings as meeting}
							<div class="group flex items-center gap-2">
								<button
									type="button"
									class="flex flex-1 items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
									onclick={() => onOpen(meeting)}
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium">{meeting.title}</p>
										<div class="mt-0.5 flex items-center gap-2">
											<span class="flex items-center gap-1 text-xs text-zinc-500">
												<Clock class="h-3 w-3" />
												{timeAgo(meeting.created_at)}
											</span>
											<span class="text-xs text-zinc-500">{nodeCount(meeting)}</span>
										</div>
									</div>
									<ChevronRight class="h-4 w-4 shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100" />
								</button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100"
									onclick={() => onDelete(meeting.id)}
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
