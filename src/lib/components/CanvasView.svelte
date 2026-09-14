<script lang="ts">
	import { Icon, ArrowLeft, MessageCircle } from '@lucide/svelte';
	import type { MeetingMap, Meeting } from '$shared/types';
	import ChatPanel from './ChatPanel.svelte';

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

	const flatNodes = $derived(flatten(meeting.map?.nodes ?? []));

	function flatten(nodes: MeetingMap['nodes'], depth = 0): { node: MeetingMap['nodes'][number]; depth: number }[] {
		let out: { node: MeetingMap['nodes'][number]; depth: number }[] = [];
		for (const node of nodes) {
			out.push({ node, depth });
			if (node.children?.length) {
				out = out.concat(flatten(node.children, depth + 1));
			}
		}
		return out;
	}
</script>

<div class="flex h-screen flex-col">
	<div class="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
		<div class="flex items-center gap-3">
			<button onclick={onBack} class="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
				<Icon icon={ArrowLeft} class="h-5 w-5" />
			</button>
			<h2 class="text-lg font-semibold">{meeting.title}</h2>
		</div>
		<button onclick={() => (showChat = !showChat)} class="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
			<Icon icon={MessageCircle} class="h-4 w-4" />
			{showChat ? 'Hide chat' : 'Chat'}
		</button>
	</div>

	<div class="flex flex-1 overflow-hidden">
		<div class="flex-1 overflow-auto p-6">
			{#if meeting.status === 'error'}
				<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					Analysis failed: {meeting.error}
				</div>
			{:else if flatNodes.length === 0}
				<div class="text-zinc-500">No analysis nodes yet.</div>
			{:else}
				<div class="space-y-4">
					{#each flatNodes as { node, depth }}
						<div class="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900" style="margin-left: {depth * 24}px">
							<h3 class="font-semibold">{node.title}</h3>
							<p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{node.summary}</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if showChat}
			<ChatPanel meetingId={meeting.id} provider={meeting.provider} model={meeting.model} />
		{/if}
	</div>
</div>
