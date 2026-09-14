<script lang="ts">
	import { onMount } from 'svelte';
	import InputScreen from '$lib/components/InputScreen.svelte';
	import CanvasView from '$lib/components/CanvasView.svelte';
	import LiveMeetingView from '$lib/components/LiveMeetingView.svelte';
	import {
		listMeetings,
		createMeeting,
		getMeeting,
		deleteMeeting,
		analyzeMeeting
	} from '$lib/api';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';

	type View = 'input' | 'live' | 'canvas';

	let view = $state<View>('input');
	let liveSTTProvider = $state<STTProvider>('deepgram');
	let meetings = $state<Meeting[]>([]);
	let currentMeeting = $state<Meeting | null>(null);
	let currentTranscript = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let progress = $state<{ processed: number; total: number } | null>(null);

	onMount(loadMeetings);

	async function loadMeetings() {
		try { meetings = await listMeetings(); }
		catch (err) { error = `Could not load meetings: ${err instanceof Error ? err.message : String(err)}`; }
	}

	async function handleSubmit(transcript: string, provider: AIProvider, model: string) {
		isLoading = true;
		error = '';
		progress = null;
		try {
			const { id } = await createMeeting({ transcript, provider, model });
			for await (const event of analyzeMeeting(id, provider, model)) {
				if (event && typeof event === 'object' && 'type' in event) {
					if (event.type === 'error') throw new Error(event.message);
					if (event.type === 'progress') progress = { processed: event.processed as number, total: event.total as number };
				}
			}
			const full = await getMeeting(id);
			currentMeeting = full.meeting;
			currentTranscript = full.transcript;
			await loadMeetings();
			view = 'canvas';
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			isLoading = false;
			progress = null;
		}
	}

	async function handleOpen(meeting: Meeting) {
		try {
			const full = await getMeeting(meeting.id);
			currentMeeting = full.meeting;
			currentTranscript = full.transcript;
			view = 'canvas';
		} catch (err) { error = `Could not open meeting: ${err instanceof Error ? err.message : String(err)}`; }
	}

	async function handleDelete(id: string) {
		try { await deleteMeeting(id); await loadMeetings(); }
		catch (err) { error = `Could not delete meeting: ${err instanceof Error ? err.message : String(err)}`; }
	}

	function handleLiveEnd(meeting: Meeting | null, err?: string, transcript = '') {
		if (meeting) {
			currentTranscript = transcript;
			currentMeeting = meeting;
			loadMeetings();
			view = 'canvas';
		} else {
			if (err) error = err;
			view = 'input';
		}
	}
</script>

{#if view === 'live'}
	<LiveMeetingView bind:sttProvider={liveSTTProvider} onEnd={handleLiveEnd} />
{:else if view === 'canvas' && currentMeeting}
	<CanvasView meeting={currentMeeting} transcript={currentTranscript} onBack={() => { currentMeeting = null; view = 'input'; loadMeetings(); }} />
{:else}
	<InputScreen
		{isLoading}
		{error}
		{progress}
		savedMeetings={meetings}
		onSubmit={handleSubmit}
		onStartLive={(provider) => { liveSTTProvider = provider; view = 'live'; }}
		onOpen={handleOpen}
		onDelete={handleDelete}
	/>
{/if}
