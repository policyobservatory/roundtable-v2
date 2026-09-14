<script lang="ts">
	import { Icon, Mic, Square, ArrowLeft, Loader2 } from '@lucide/svelte';
	import { createMeeting, appendSegment, analyzeMeeting } from '$lib/api';
	import { transcribe } from '$lib/api';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { AI_PROVIDERS, STT_PROVIDERS } from '$lib/constants';

	let {
		onEnd
	}: {
		onEnd: (meeting: Meeting | null, error?: string) => void;
	} = $props();

	let title = $state('');
	let aiProvider = $state<AIProvider>('openrouter');
	let aiModel = $state('openai/gpt-4o-mini');
	let sttProvider = $state<STTProvider>('deepgram');

	let meetingId = $state<string | null>(null);
	let recording = $state(false);
	let recorder = $state<MediaRecorder | null>(null);
	let segments = $state<string[]>([]);
	let status = $state('');
	let analyzing = $state(false);

	async function start() {
		const res = await createMeeting({
			title: title || `Live meeting ${new Date().toLocaleString()}`,
			transcript: '',
			provider: aiProvider,
			model: aiModel
		});
		meetingId = res.id;
		recording = true;
		status = 'Recording… send audio chunks via STT';
	}

	async function stop() {
		recorder?.stop();
		recorder?.stream.getTracks().forEach((t) => t.stop());
		recording = false;
		if (meetingId) {
			analyzing = true;
			status = 'Analyzing…';
			try {
				for await (const event of analyzeMeeting(meetingId, aiProvider, aiModel)) {
					if (event && typeof event === 'object' && 'type' in event) {
						if (event.type === 'progress') status = `Analyzed ${event.processed}/${event.total}`;
						if (event.type === 'complete') {
							const { meeting } = await import('$lib/api').then((m) => m.getMeeting(meetingId as string));
							onEnd(meeting);
							return;
						}
					}
				}
			} catch (err: unknown) {
				onEnd(null, err instanceof Error ? err.message : String(err));
			} finally {
				analyzing = false;
			}
		} else {
			onEnd(null);
		}
	}

	async function captureChunk() {
		if (!meetingId) return;
		const mid = meetingId;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
			const chunks: Blob[] = [];
			mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
			mediaRecorder.onstop = async () => {
				const blob = new Blob(chunks, { type: 'audio/webm' });
				if (blob.size < 1000) return;
				try {
					const { text } = await transcribe(sttProvider, blob);
					if (text.trim()) {
						segments = [...segments, text];
						await appendSegment({ meeting_id: mid, text });
					}
				} catch (err: unknown) {
					status = `STT error: ${err instanceof Error ? err.message : String(err)}`;
				}
			};
			recorder = mediaRecorder;
			mediaRecorder.start();
			setTimeout(() => mediaRecorder.stop(), 5000);
		} catch (err: unknown) {
			status = `Microphone error: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	$effect(() => {
		if (!recording || !meetingId) return;
		const interval = setInterval(captureChunk, 6000);
		return () => clearInterval(interval);
	});
</script>

<div class="mx-auto max-w-3xl p-6">
	<button onclick={() => onEnd(null)} class="mb-6 inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900">
		<Icon icon={ArrowLeft} class="h-4 w-4" /> Back
	</button>

	<h1 class="mb-6 text-2xl font-bold">Live meeting</h1>

	<div class="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
		<input bind:value={title} placeholder="Meeting title" class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-950" />

		<div class="grid gap-3 md:grid-cols-3">
			<div>
				<label for="live-ai-provider" class="text-sm font-medium">AI provider</label>
				<select id="live-ai-provider" bind:value={aiProvider} class="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950">
					{#each AI_PROVIDERS as p}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="live-ai-model" class="text-sm font-medium">AI model</label>
				<input id="live-ai-model" bind:value={aiModel} class="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
			</div>
			<div>
				<label for="live-stt-provider" class="text-sm font-medium">STT provider</label>
				<select id="live-stt-provider" bind:value={sttProvider} class="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950">
					{#each STT_PROVIDERS as p}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if !recording}
			<button onclick={start} class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 font-medium text-white hover:bg-red-700">
				<Icon icon={Mic} class="h-5 w-5" /> Start recording
			</button>
		{:else}
			<button onclick={stop} disabled={analyzing} class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
				{#if analyzing}
					<Icon icon={Loader2} class="h-5 w-5 animate-spin" /> {status}
				{:else}
					<Icon icon={Square} class="h-5 w-5" /> Stop & analyze
				{/if}
			</button>
		{/if}

		{#if status}
			<p class="text-sm text-zinc-600 dark:text-zinc-400">{status}</p>
		{/if}

		{#if segments.length}
			<div class="max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
				{#each segments as segment}
					<p class="mb-2">{segment}</p>
				{/each}
			</div>
		{/if}
	</div>
</div>
