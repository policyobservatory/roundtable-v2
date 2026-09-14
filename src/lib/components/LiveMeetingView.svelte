<script lang="ts">
	import { Mic, Square, ArrowLeft, Loader2 } from '@lucide/svelte';
	import { createMeeting, appendSegment, analyzeMeeting } from '$lib/api';
	import { transcribe } from '$lib/api';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { AI_PROVIDERS, STT_PROVIDERS } from '$lib/constants';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	let {
		onEnd
	}: {
		onEnd: (meeting: Meeting | null, error?: string) => void;
	} = $props();

	let aiProvider = $state<AIProvider>('openrouter');
	let aiModel = $state('openai/gpt-4o-mini');
	let sttProvider = $state<STTProvider>('deepgram');

	let meetingId = $state<string | null>(null);
	let recording = $state(false);
	let recorder = $state<MediaRecorder | null>(null);
	let segments = $state<string[]>([]);
	let status = $state('');
	let analyzing = $state(false);

	const aiOptions = AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));
	const sttOptions = STT_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

	async function start() {
		const res = await createMeeting({
			transcript: '',
			provider: aiProvider,
			model: aiModel
		});
		meetingId = res.id;
		recording = true;
		status = 'Recording...';
	}

	async function stop() {
		recorder?.stop();
		recorder?.stream.getTracks().forEach((t) => t.stop());
		recording = false;
		if (meetingId) {
			analyzing = true;
			status = 'Analyzing...';
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

<div class="flex min-h-screen flex-col items-center bg-zinc-50/50 px-6 py-10 dark:bg-zinc-950/50">
	<div class="w-full max-w-2xl">
		<Button variant="ghost" size="sm" onclick={() => onEnd(null)} class="mb-6 gap-1.5">
			<ArrowLeft class="h-4 w-4" /> Back
		</Button>

		<h1 class="mb-6 text-3xl font-semibold tracking-tight">Live meeting</h1>

		<Card class="p-6">
			<div class="space-y-5">
				<div class="grid gap-4 md:grid-cols-[1fr,1.5fr]">
					<div>
						<label for="live-ai-provider" class="mb-1 block text-xs font-medium text-zinc-500">AI provider</label>
						<Select id="live-ai-provider" bind:value={aiProvider} options={aiOptions} />
					</div>
					<div>
						<label for="live-ai-model" class="mb-1 block text-xs font-medium text-zinc-500">AI model</label>
						<input id="live-ai-model" bind:value={aiModel} class="h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950" />
					</div>
				</div>

				<div>
					<label for="live-stt-provider" class="mb-1 block text-xs font-medium text-zinc-500">STT provider</label>
					<Select id="live-stt-provider" bind:value={sttProvider} options={sttOptions} />
				</div>

				{#if !recording}
					<Button size="lg" class="w-full bg-red-600 hover:bg-red-700" onclick={start}>
						<Mic class="h-5 w-5" /> Start recording
					</Button>
				{:else}
					<Button size="lg" class="w-full" onclick={stop} disabled={analyzing}>
						{#if analyzing}
							<Loader2 class="h-5 w-5 animate-spin" /> {status}
						{:else}
							<Square class="h-5 w-5" /> Stop & analyze
						{/if}
					</Button>
				{/if}

				{#if status}
					<p class="text-center text-sm text-zinc-500">{status}</p>
				{/if}
			</div>
		</Card>

		{#if segments.length}
			<Card class="mt-6 max-h-80 overflow-auto p-4">
				<h3 class="mb-2 text-sm font-medium">Transcript segments</h3>
				<div class="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
					{#each segments as segment}
						<p class="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">{segment}</p>
					{/each}
				</div>
			</Card>
		{/if}
	</div>
</div>
