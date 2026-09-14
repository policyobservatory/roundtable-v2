<script lang="ts">
	import { Mic, Monitor, Square, ArrowLeft, Loader2 } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { createMeeting, appendSegment, analyzeMeeting, getMeeting, transcribe } from '$lib/api';
	import { acquireAudio, recordAudio, stopMediaStream, type AudioSource, type AudioRecording } from '$lib/live-audio';
	import type { Meeting, STTProvider } from '$shared/types';
	import { DEFAULT_AI_MODEL, getAIModel, STT_PROVIDERS } from '$lib/constants';
	import ModelSelect from '$lib/components/ModelSelect.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	let {
		onEnd,
		sttProvider = $bindable<STTProvider>('deepgram')
	}: {
		onEnd: (meeting: Meeting | null, error?: string) => void;
		sttProvider?: STTProvider;
	} = $props();

	let selectedModelId = $state(DEFAULT_AI_MODEL.id);
	const selectedModel = $derived(getAIModel(selectedModelId));

	let meetingId = $state<string | null>(null);
	let recording = $state(false);
	let starting = $state(false);
	let audioSource = $state<AudioSource>('microphone');
	let stopping = $state(false);
	let capture: AudioRecording | null = null;
	let sourceStream: MediaStream | null = null;
	let disposed = false;
	let segments = $state<string[]>([]);
	let status = $state('');
	let analyzing = $state(false);

	const busy = $derived(starting || recording || stopping || analyzing);
	const sttOptions = STT_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));
	const sourceOptions = [
		{ value: 'microphone', label: 'Microphone' },
		{ value: 'tab', label: 'Browser tab audio' }
	];

	onDestroy(() => {
		disposed = true;
		capture?.dispose();
		if (sourceStream) stopMediaStream(sourceStream);
	});

	async function start() {
		if (busy) return;
		starting = true;
		status = audioSource === 'tab' ? 'Choose a tab and enable Share tab audio...' : 'Requesting microphone access...';
		try {
			// Request permission before creating a meeting, directly from the user gesture.
			const stream = await acquireAudio(audioSource);
			if (disposed) { stopMediaStream(stream); return; }
			sourceStream = stream;
			const provider = sttProvider;
			const res = await createMeeting({
				transcript: '',
				provider: selectedModel.provider,
				model: selectedModel.model
			});
			if (disposed) { stopMediaStream(stream); return; }
			if (stream.getTracks().some((track) => track.readyState === 'ended')) {
				throw new Error('Audio sharing ended before recording started. Please try again.');
			}
			meetingId = res.id;
			segments = [];
			capture = recordAudio(stream, async (blob) => {
				const { text } = await transcribe(provider, blob);
				if (disposed || !text.trim()) return;
				await appendSegment({ meeting_id: res.id, text });
				if (!disposed) segments = [...segments, text];
			}, (err) => { status = `Audio error: ${err.message}`; }, () => { void stop(); });
			recording = true;
			status = audioSource === 'tab' ? 'Transcribing shared tab audio...' : 'Transcribing microphone audio...';
		} catch (err: unknown) {
			if (sourceStream) stopMediaStream(sourceStream);
			sourceStream = null;
			status = err instanceof Error ? err.message : String(err);
		} finally {
			starting = false;
		}
	}

	async function stop() {
		if (!recording || stopping || analyzing) return;
		recording = false;
		stopping = true;
		status = 'Finishing transcription and saving the final audio chunk...';
		try {
			await capture?.stop();
			capture = null;
			sourceStream = null;
			if (disposed) return;
			if (!segments.length || !meetingId) {
				status = 'No speech was detected. Check that the selected source is playing audio, then try again.';
				return;
			}
			analyzing = true;
			status = 'Analyzing...';
			for await (const event of analyzeMeeting(meetingId, selectedModel.provider, selectedModel.model)) {
				if (disposed) return;
				if (event.type === 'error') throw new Error(event.message);
				if (event.type === 'progress') status = `Analyzed ${event.processed}/${event.total}`;
				if (event.type === 'complete') {
					const { meeting } = await getMeeting(meetingId);
					if (!disposed) onEnd(meeting);
					return;
				}
			}
			throw new Error('Analysis ended without a completed meeting.');
		} catch (err: unknown) {
			status = `Could not finish the meeting: ${err instanceof Error ? err.message : String(err)}. Saved transcript segments are still available in Past Meetings.`;
		} finally {
			capture?.dispose();
			capture = null;
			sourceStream = null;
			stopping = false;
			analyzing = false;
		}
	}
</script>

<div class="flex min-h-screen flex-col items-center bg-zinc-50/50 px-6 py-10 dark:bg-zinc-950/50">
	<div class="w-full max-w-2xl">
		<Button variant="ghost" size="sm" onclick={() => onEnd(null)} class="mb-6 gap-1.5">
			<ArrowLeft class="h-4 w-4" /> Back
		</Button>

		<h1 class="mb-6 text-3xl font-semibold tracking-tight">Live meeting</h1>

		<Card class="p-6">
			<div class="space-y-5">
				<ModelSelect id="live-ai-model" bind:value={selectedModelId} disabled={busy} />

				<div class="space-y-2">
					<Select id="live-audio-source" label="Audio source" bind:value={audioSource} options={sourceOptions} disabled={busy} />
					{#if audioSource === 'tab'}
						<p class="text-xs leading-relaxed text-zinc-500">
							Use desktop Chrome or Edge. In the sharing picker, choose a browser tab and enable
							<strong>Share tab audio</strong>. Only shared audio is sent for transcription, not video.
							Your microphone is not included. Let participants know before transcribing.
						</p>
					{/if}
				</div>

				<div>
					<label for="live-stt-provider" class="mb-1 block text-xs font-medium text-zinc-500">STT provider</label>
					<Select id="live-stt-provider" bind:value={sttProvider} options={sttOptions} disabled={busy} />
				</div>

				{#if starting || stopping || analyzing}
					<Button size="lg" class="w-full" disabled>
						<Loader2 class="h-5 w-5 animate-spin" />
						{starting ? 'Starting...' : stopping && !analyzing ? 'Finishing transcription...' : 'Analyzing...'}
					</Button>
				{:else if recording}
					<Button size="lg" class="w-full" onclick={stop}>
						<Square class="h-5 w-5" /> Stop & analyze
					</Button>
				{:else}
					<Button size="lg" class="w-full bg-red-600 hover:bg-red-700" onclick={start}>
						{#if audioSource === 'tab'}
							<Monitor class="h-5 w-5" /> Share tab & start
						{:else}
							<Mic class="h-5 w-5" /> Start recording
						{/if}
					</Button>
				{/if}

				{#if status}
					<p role="status" class="text-center text-sm text-zinc-500">{status}</p>
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
