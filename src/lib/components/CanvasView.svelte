<script lang="ts">
	import { ArrowLeft, MessageCircle, FileText, ChevronDown, ChevronRight } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import type { MeetingMap, Meeting } from '$shared/types';

	let {
		meeting,
		transcript,
		onBack
	}: {
		meeting: Meeting;
		transcript: string;
		onBack: () => void;
	} = $props();

	let showChat = $state(false);
	let showTranscript = $state(true);
	let expandAll = $state(true);

	const flatNodes = $derived(flatten(meeting.map?.nodes ?? [], 0));

	function flatten(nodes: MeetingMap['nodes'], depth = 0): { node: MeetingMap['nodes'][number]; depth: number }[] {
		let out: { node: MeetingMap['nodes'][number]; depth: number }[] = [];
		for (const node of nodes) {
			out.push({ node, depth });
			if (expandAll && node.children?.length) {
				out = out.concat(flatten(node.children, depth + 1));
			}
		}
		return out;
	}
</script>

<div class="flex h-screen flex-col overflow-hidden bg-zinc-50/50 dark:bg-zinc-950/50">
	<!-- Top bar -->
	<div class="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-2.5 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="sm" onclick={onBack} class="gap-1.5">
				<ArrowLeft class="h-4 w-4" />
				New transcript
			</Button>
			<Button variant="ghost" size="sm" onclick={() => (showTranscript = !showTranscript)} class="gap-1.5">
				<FileText class="h-4 w-4" />
				{showTranscript ? 'Hide Transcript' : 'Show Transcript'}
			</Button>
		</div>
		<h2 class="text-sm font-semibold">{meeting.title}</h2>
		<div class="flex items-center gap-2">
			<Badge variant="secondary">{meeting.status}</Badge>
			<Button size="sm" onclick={() => (showChat = !showChat)} class="gap-1.5">
				<MessageCircle class="h-4 w-4" />
				{showChat ? 'Hide chat' : 'Chat'}
			</Button>
		</div>
	</div>

	<!-- Main area -->
	<div class="flex flex-1 overflow-hidden">
		{#if showTranscript}
			<div class="w-80 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
				<h3 class="mb-3 text-sm font-medium">Transcript</h3>
				<p class="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{transcript}</p>
			</div>
		{/if}

		<!-- Canvas -->
		<div class="flex-1 overflow-y-auto p-6">
			{#if meeting.status === 'error'}
				<Card class="border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					Analysis failed: {meeting.error}
				</Card>
			{:else if flatNodes.length === 0}
				<div class="flex h-full items-center justify-center text-zinc-500">No analysis nodes yet.</div>
			{:else}
				<div class="mx-auto max-w-3xl space-y-4">
					<div class="flex items-center justify-between">
						<p class="text-xs text-zinc-500">{flatNodes.length} nodes</p>
						<Button variant="ghost" size="sm" onclick={() => (expandAll = !expandAll)}>
							{#if expandAll}
								<ChevronDown class="h-4 w-4" /> Collapse
							{:else}
								<ChevronRight class="h-4 w-4" /> Expand
							{/if}
						</Button>
					</div>
					{#each flatNodes as { node, depth }}
						<div class="relative" style="margin-left: {depth * 28}px">
							<!-- connector -->
							{#if depth > 0}
								<div class="absolute -left-4 top-0 h-full w-px bg-zinc-200 dark:bg-zinc-800"></div>
								<div class="absolute -left-4 top-6 h-px w-4 bg-zinc-200 dark:bg-zinc-800"></div>
							{/if}
							<Card id="node-{node.id}" class="border-l-4 border-l-zinc-900 p-4 dark:border-l-zinc-100">
								<h3 class="font-medium">{node.title}</h3>
								<p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{node.summary}</p>
							</Card>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- TOC -->
		<div class="w-72 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
			<h3 class="mb-3 text-sm font-medium">Table of Contents</h3>
			<ul class="space-y-1">
				{#each flatNodes as { node }}
					<li>
						<button
							onclick={() => {
								const el = document.getElementById(`node-${node.id}`);
								el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
							}}
							class="w-full rounded-md p-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
						>
							{node.title}
						</button>
					</li>
				{/each}
			</ul>
		</div>

		{#if showChat}
			<ChatPanel meetingId={meeting.id} provider={meeting.provider} model={meeting.model} />
		{/if}
	</div>
</div>
