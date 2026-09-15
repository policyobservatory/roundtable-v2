<script lang="ts">
	import { ArrowLeft, MessageCircle, FileText, RefreshCw, Loader2 } from '@lucide/svelte';
	import { analyzeMeeting, getMeeting } from '$lib/api';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import FlowCanvas from './FlowCanvas.svelte';
	import type { Meeting, TranscriptSegment } from '$shared/types';
	import TranscriptView from './TranscriptView.svelte';

	let { meeting, transcript, segments = [], baseTranscript = '', onBack }: { meeting: Meeting; transcript: string; segments?: TranscriptSegment[]; baseTranscript?: string; onBack: () => void } = $props();
	let showChat = $state(false);
	let showTranscript = $state(true);
	let retrying = $state(false);
	let retryError = $state('');

	async function retryAnalysis() {
		if (retrying) return;
		retrying = true;
		retryError = '';
		try {
			for await (const event of analyzeMeeting(meeting.id, meeting.provider, meeting.model)) {
				if (event.type === 'error') throw new Error(event.message);
				if (event.type === 'complete') {
					const result = await getMeeting(meeting.id);
					meeting = result.meeting;
					transcript = result.transcript;
					segments = result.segments ?? [];
					baseTranscript = result.baseTranscript ?? '';
					return;
				}
			}
			throw new Error('Analysis ended without a completed map.');
		} catch (err) { retryError = err instanceof Error ? err.message : String(err); }
		finally { retrying = false; }
	}
</script>

<div class="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="sm" onclick={onBack}><ArrowLeft class="h-4 w-4" /> New transcript</Button>
			<Button variant="ghost" size="sm" onclick={() => showTranscript = !showTranscript}><FileText class="h-4 w-4" /> {showTranscript ? 'Hide transcript' : 'Show transcript'}</Button>
		</div>
		<h2 class="text-sm font-semibold">{meeting.title}</h2>
		<div class="flex items-center gap-2"><Badge variant="secondary">{meeting.status}</Badge><Button size="sm" onclick={() => showChat = !showChat}><MessageCircle class="h-4 w-4" /> {showChat ? 'Hide chat' : 'Chat'}</Button></div>
	</div>
	{#if meeting.error || retryError}<p role="alert" class="bg-red-50 px-4 py-2 text-sm text-red-700">Analysis: {retryError || meeting.error}</p>{/if}
	{#if meeting.status !== 'completed' || meeting.error}
		<div class="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
			<span>The saved transcript can be analyzed again without recording it again.</span>
			<Button size="sm" variant="outline" onclick={retryAnalysis} disabled={retrying || !transcript.trim()}>{#if retrying}<Loader2 class="h-4 w-4 animate-spin" /> Analyzing...{:else}<RefreshCw class="h-4 w-4" /> Retry analysis{/if}</Button>
		</div>
	{/if}
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
		{#if showTranscript}
			<aside class="max-h-[35vh] shrink-0 overflow-auto border-b border-zinc-200 bg-white p-4 md:max-h-none md:w-80 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950">
				<h3 class="mb-3 text-sm font-medium">Transcript</h3>
				<TranscriptView {transcript} {segments} {baseTranscript} />
			</aside>
		{/if}
		<div class="min-h-0 min-w-0 flex-1"><FlowCanvas meetingId={meeting.id} map={meeting.map ?? { nodes: [], edges: [] }} updating={retrying} view="organized" /></div>
		{#if showChat}<ChatPanel meetingId={meeting.id} provider={meeting.provider} model={meeting.model} />{/if}
	</div>
</div>
