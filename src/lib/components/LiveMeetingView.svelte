<script lang="ts">
	import { Mic, Monitor, Square, ArrowLeft, Loader2, Download, Check, RefreshCw } from '@lucide/svelte';
	import { onDestroy, onMount, tick } from 'svelte';
	import { createMeeting, appendSegment, analyzeMeeting, getMeeting, transcribe, previewLiveMap } from '$lib/api';
	import { acquireAudio, recordAudio, stopMediaStream, type AudioSource, type AudioRecording } from '$lib/live-audio';
	import { createProgressiveMap } from '$lib/progressive-map';
	import { readLiveDraft, saveLiveDraft, clearLiveDraft, persistLiveSegment, type LiveSegment, type LiveDraft } from '$lib/live-session';
	import type { Meeting, MeetingMap, STTProvider } from '$shared/types';
	import { DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';
	import { DEFAULT_SPEECH_LANGUAGE, DEFAULT_STT_PROVIDER, LIVE_AUDIO_CHUNK_MS, SPEECH_LANGUAGES, speechLanguageError, type SpeechLanguage } from '$shared/speech-settings';
	import SpeechSettings from './SpeechSettings.svelte';
	import ModelSelect from './ModelSelect.svelte';
	import FlowCanvas from './FlowCanvas.svelte';
	import Button from './ui/Button.svelte';
	import Card from './ui/Card.svelte';
	import Select from './ui/Select.svelte';

	let { onEnd, sttProvider = $bindable<STTProvider>(DEFAULT_STT_PROVIDER), speechLanguage = $bindable<SpeechLanguage>(DEFAULT_SPEECH_LANGUAGE), audioSource = $bindable<AudioSource>('microphone') }: {
		onEnd: (meeting: Meeting | null, error?: string, transcript?: string) => void;
		sttProvider?: STTProvider;
		speechLanguage?: SpeechLanguage;
		audioSource?: AudioSource;
	} = $props();

	let selectedModelId = $state(DEFAULT_AI_MODEL.id);
	const selectedModel = $derived(getAIModel(selectedModelId));
	let meetingId = $state<string | null>(null);
	let recording = $state(false);
	let starting = $state(false);
	let finishing = $state(false);
	let capture: AudioRecording | null = null;
	let sourceStream: MediaStream | null = null;
	let disposed = false;
	let segments = $state<LiveSegment[]>([]);
	let status = $state('');
	let error = $state('');
	let storageWarning = $state('');
	let audioWarning = $state('');
	let previewError = $state('');
	let map = $state<MeetingMap>({ nodes: [], edges: [] });
	let mapUpdating = $state(false);
	let finalMeeting = $state<Meeting | null>(null);
	let recovery = $state<LiveDraft | null>(null);
	let elapsed = $state(0);
	let startedAt = 0;
	let clock: ReturnType<typeof setInterval> | undefined;
	let progressive: ReturnType<typeof createProgressiveMap> | null = null;
	let transcriptPanel = $state<HTMLDivElement>();
	let followTranscript = $state(true);
	const transcript = $derived(segments.map((segment) => segment.text).join('\n'));
	const unsaved = $derived(segments.filter((segment) => !segment.saved).length);
	const sourceOptions = [{ value: 'microphone', label: 'Microphone' }, { value: 'tab', label: 'Browser tab audio' }];

	onMount(() => {
		try { recovery = readLiveDraft(localStorage); } catch { /* Storage may be unavailable. */ }
	});
	onDestroy(() => {
		disposed = true;
		clearInterval(clock);
		progressive?.dispose();
		capture?.dispose();
		if (sourceStream) stopMediaStream(sourceStream);
	});
	$effect(() => {
		segments.length;
		if (followTranscript) void tick().then(() => {
			if (!disposed && transcriptPanel) transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
		});
	});

	function cacheDraft() {
		if (!meetingId) return;
		try {
			if (!saveLiveDraft(localStorage, { meetingId, modelId: selectedModelId, segments })) throw new Error();
			storageWarning = '';
		} catch { storageWarning = 'Browser recovery storage is unavailable. Download the transcript before leaving this page.'; }
	}
	function discardRecovery() {
		try { clearLiveDraft(localStorage); } catch { /* Best effort. */ }
		recovery = null;
	}
	function restore() {
		if (!recovery) return;
		meetingId = recovery.meetingId;
		selectedModelId = getAIModel(recovery.modelId).id;
		segments = recovery.segments;
		recovery = null;
		status = 'Recovered transcript. Retry saving and analysis, or download a copy.';
	}
	function download() {
		const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url; link.download = `roundtable-${meetingId ?? 'transcript'}.txt`; link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function leave() {
		if (!finalMeeting && (recording || unsaved || finishing) && !confirm('Leave this meeting? Capture will stop. Recognized text is kept in this browser when recovery storage is available; download a copy first if needed.')) return;
		if (finalMeeting) {
			try { clearLiveDraft(localStorage); } catch { /* Best effort. */ }
			onEnd(finalMeeting, undefined, transcript);
		} else onEnd(null);
	}
	async function savePending() {
		for (const segment of segments) {
			if (disposed) return;
			if (segment.saved) continue;
			await persistLiveSegment(segment, appendSegment);
			cacheDraft();
		}
	}
	function beginPreview() {
		progressive = createProgressiveMap({
			transcript: () => transcript, map: () => map,
			request: (text, previous, signal) => previewLiveMap(text, previous, selectedModel.provider, selectedModel.model, signal),
			onMap: (next) => { map = next; }, onBusy: (busy) => { mapUpdating = busy; },
			onError: (message) => { previewError = message; }
		});
	}
	async function start() {
		if (starting || recovery) return;
		const languageError = speechLanguageError(sttProvider, speechLanguage);
		if (languageError) { error = languageError; return; }
		starting = true;
		error = '';
		status = audioSource === 'tab' ? 'Choose a tab and enable Share tab audio...' : 'Requesting microphone access...';
		try {
			const stream = await acquireAudio(audioSource);
			if (disposed) { stopMediaStream(stream); return; }
			sourceStream = stream;
			const provider = sttProvider;
			const language = speechLanguage;
			const res = await createMeeting({ transcript: '', provider: selectedModel.provider, model: selectedModel.model });
			if (disposed) { stopMediaStream(stream); return; }
			if (stream.getTracks().some((track) => track.readyState === 'ended')) throw new Error('Audio sharing ended before recording started. Please try again.');
			meetingId = res.id;
			segments = [];
			cacheDraft();
			beginPreview();
			capture = recordAudio(stream, async (blob) => {
				const { text } = await transcribe(provider, blob, language);
				if (disposed || !text.trim()) return;
				// Display and back up text BEFORE attempting any D1 write.
				segments = [...segments, { id: crypto.randomUUID(), meeting_id: res.id, segment_index: segments.length, text: text.trim(), created_at: new Date().toISOString(), saved: false }];
				cacheDraft();
				progressive?.notify();
				try { await savePending(); error = ''; }
				catch (err) { error = `Saving interrupted: ${err instanceof Error ? err.message : String(err)}. Recognized text remains here; saving will retry.`; }
			}, (err) => { audioWarning = `Some audio could not be transcribed: ${err.message}. Saving or analyzing again can only recover recognized text, not missing audio.`; }, () => { void finish(); }, LIVE_AUDIO_CHUNK_MS);
			recording = true;
			startedAt = Date.now();
			clock = setInterval(() => elapsed = Math.floor((Date.now() - startedAt) / 1000), 1000);
			status = audioSource === 'tab' ? 'Transcribing shared tab audio' : 'Transcribing microphone audio';
		} catch (err) {
			if (sourceStream) stopMediaStream(sourceStream);
			sourceStream = null;
			error = err instanceof Error ? err.message : String(err);
		} finally { starting = false; }
	}

	async function finish() {
		if (finishing || !meetingId || finalMeeting) return;
		finishing = true;
		recording = false;
		clearInterval(clock);
		progressive?.dispose();
		progressive = null;
		error = '';
		status = 'Finishing transcription...';
		try {
			if (capture) {
				const current = capture;
				capture = null;
				await current.stop();
			}
			sourceStream = null;
			if (disposed) return;
			if (!segments.length) { status = 'No speech was detected. You can go back and try another source.'; return; }
			status = 'Saving transcript...';
			await savePending();
			if (disposed) return;
			status = 'Building final conversation map...';
			for await (const event of analyzeMeeting(meetingId, selectedModel.provider, selectedModel.model)) {
				if (disposed) return;
				if (event.type === 'error') throw new Error(event.message);
				if (event.type === 'progress') status = `Analyzing part ${event.processed + 1} of ${event.total}...`;
				if (event.type === 'complete') {
					const result = await getMeeting(meetingId);
					if (disposed) return;
					finalMeeting = result.meeting;
					map = event.map;
					status = 'Meeting saved. Review the map, then Save & exit.';
					return;
				}
			}
			throw new Error('Analysis ended without a completed map.');
		} catch (err) {
			error = `Could not finish: ${err instanceof Error ? err.message : String(err)}. Your recognized transcript is still shown below. Retry saving and analysis, or download it.`;
			cacheDraft();
		} finally {
			if (sourceStream) stopMediaStream(sourceStream);
			sourceStream = null;
			finishing = false;
		}
	}
</script>

{#if !meetingId}
	<div class="mx-auto min-h-screen max-w-2xl px-4 py-10">
		<Button variant="ghost" size="sm" onclick={leave}><ArrowLeft class="h-4 w-4" /> Back</Button>
		<h1 class="my-6 text-3xl font-semibold">Live meeting</h1>
		{#if recovery}
			<Card class="mb-4 space-y-3 border-amber-300 p-4">
				<p class="text-sm">An unfinished transcript was found in this browser ({recovery.segments.length} segments).</p>
				<div class="flex gap-2"><Button onclick={restore}>Restore transcript</Button><Button variant="outline" onclick={discardRecovery}>Discard draft</Button></div>
			</Card>
		{/if}
		<Card class="space-y-5 p-6">
			<ModelSelect id="live-ai-model" bind:value={selectedModelId} disabled={starting} />
			<Select id="live-audio-source" label="Audio source" bind:value={audioSource} options={sourceOptions} disabled={starting} />
			{#if audioSource === 'tab'}<p class="text-xs leading-relaxed text-zinc-500">Use desktop Chrome or Edge. Choose a browser tab and enable <strong>Share tab audio</strong>. Only audio is uploaded, not video; the microphone is not mixed in. Let participants know before transcribing.</p>{/if}
			<SpeechSettings idPrefix="live-speech" bind:provider={sttProvider} bind:language={speechLanguage} disabled={starting} />
			<p class="text-xs text-zinc-500">Audio is transcribed in approximately {LIVE_AUDIO_CHUNK_MS / 1000}-second clips for more context. Text appears after each clip is processed, not word by word.</p>
			<p class="text-xs text-zinc-500">The live transcript and conversation canvas appear side by side while recording. A recovery copy of recognized text is kept in this browser until Save & exit.</p>
			<Button size="lg" class="w-full" onclick={start} disabled={starting || !!recovery || !!speechLanguageError(sttProvider, speechLanguage)}>
				{#if starting}<Loader2 class="h-5 w-5 animate-spin" /> Starting...
				{:else if audioSource === 'tab'}<Monitor class="h-5 w-5" /> Share tab & start
				{:else}<Mic class="h-5 w-5" /> Start recording{/if}
			</Button>
			{#if status}<p role="status" class="text-sm text-zinc-500">{status}</p>{/if}
			{#if error}<p role="alert" class="text-sm text-red-600">{error}</p>{/if}
		</Card>
	</div>
{:else}
	<div class="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
		<header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
			<div class="flex flex-wrap items-center gap-3 text-xs">
				<Button variant="ghost" size="sm" onclick={leave}><ArrowLeft class="h-4 w-4" /> Back</Button>
				<span class={recording ? 'font-semibold text-red-600' : 'text-zinc-500'}>{recording ? '● REC' : finalMeeting ? '✓ Saved' : 'Recording stopped'}</span>
				<span class="tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
				<span class="text-zinc-500">{audioSource === 'tab' ? 'Tab audio' : 'Microphone'} · {SPEECH_LANGUAGES.find((option) => option.value === speechLanguage)?.label} · {selectedModel.label}</span>
			</div>
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={download} disabled={!segments.length}><Download class="h-4 w-4" /> Download transcript</Button>
				{#if finalMeeting}<Button size="sm" onclick={leave}><Check class="h-4 w-4" /> Save & exit</Button>
				{:else}<Button size="sm" onclick={finish} disabled={finishing || starting || (!recording && !segments.length)}>
					{#if finishing}<Loader2 class="h-4 w-4 animate-spin" /> Finishing...
					{:else if recording}<Square class="h-4 w-4" /> End meeting
					{:else}<RefreshCw class="h-4 w-4" /> Retry save & analyze{/if}
				</Button>{/if}
			</div>
		</header>
		<div class="shrink-0 border-b border-zinc-200 px-4 py-2 text-xs dark:border-zinc-800">
			<p role="status" class="text-zinc-500">{status} · {segments.length - unsaved}/{segments.length} segments saved{unsaved ? ` · ${unsaved} pending` : ''}</p>
			{#if error}<p role="alert" class="mt-1 text-red-600">{error}</p>{/if}
			{#if storageWarning || audioWarning}<p role="alert" class="mt-1 text-amber-700">{storageWarning} {audioWarning}</p>{/if}
			{#if previewError}<p class="mt-1 text-amber-700">Live map update failed; transcription continues. {previewError}</p>{/if}
		</div>
		<div class="flex min-h-0 flex-1 flex-col md:flex-row">
			<aside class="flex max-h-[35vh] shrink-0 flex-col border-b border-zinc-200 md:max-h-none md:w-[32%] md:min-w-64 md:max-w-sm md:border-b-0 md:border-r dark:border-zinc-800">
				<div class="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"><h2 class="text-sm font-medium">Live transcript</h2><button class="text-xs text-blue-600" onclick={() => followTranscript = true}>{followTranscript ? 'Following' : 'Follow latest'}</button></div>
				<div bind:this={transcriptPanel} class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" onscroll={(event) => { const panel = event.currentTarget; followTranscript = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80; }}>
					{#if !segments.length}<p class="text-sm italic text-zinc-500">Waiting for speech...</p>{/if}
					{#each segments as segment (segment.id)}
						<div><p class="text-[10px] text-zinc-500">{new Date(segment.created_at).toLocaleTimeString()} · <span class={segment.saved ? 'text-emerald-600' : 'text-amber-600'}>{segment.saved ? 'Saved' : 'Pending save'}</span></p><p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{segment.text}</p></div>
					{/each}
				</div>
			</aside>
			<div class="min-h-0 min-w-0 flex-1"><FlowCanvas {map} updating={mapUpdating || finishing} /></div>
		</div>
	</div>
{/if}
