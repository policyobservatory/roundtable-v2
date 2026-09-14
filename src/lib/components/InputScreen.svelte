<script lang="ts">
	import { Loader2, Mic, Monitor, Trash2, Clock, ChevronRight } from '@lucide/svelte';
	import type { AudioSource } from '$lib/live-audio';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';
	import { DEFAULT_SPEECH_LANGUAGE, DEFAULT_STT_PROVIDER, speechLanguageError, type SpeechLanguage } from '$shared/speech-settings';
	import SpeechSettings from '$lib/components/SpeechSettings.svelte';
	import ModelSelect from '$lib/components/ModelSelect.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import { timeAgo } from '$lib/utils';
	import { readTranscriptFile, TRANSCRIPT_ACCEPT } from '$lib/transcript-upload';

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
		onStartLive: (provider: STTProvider, source: AudioSource, language: SpeechLanguage) => void;
		onOpen: (m: Meeting) => void;
		onDelete: (id: string) => void;
	} = $props();

	let transcript = $state('');
	let isReadingFile = $state(false);
	let uploadError = $state('');
	let uploadedFileName = $state('');
	let inputDisabled = $derived(isLoading || isReadingFile);

	async function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || inputDisabled) return;

		uploadError = '';
		uploadedFileName = '';
		isReadingFile = true;
		try {
			transcript = await readTranscriptFile(file);
			uploadedFileName = file.name;
		} catch (err: unknown) {
			uploadError = err instanceof Error ? err.message : 'Could not read the transcript file.';
		} finally {
			isReadingFile = false;
			// Allow selecting the same file again, including after a failed read.
			input.value = '';
		}
	}
	let selectedModelId = $state(DEFAULT_AI_MODEL.id);
	const selectedModel = $derived(getAIModel(selectedModelId));
	let sttProvider = $state<STTProvider>(DEFAULT_STT_PROVIDER);
	let speechLanguage = $state<SpeechLanguage>(DEFAULT_SPEECH_LANGUAGE);
	const liveDisabled = $derived(inputDisabled || !!speechLanguageError(sttProvider, speechLanguage));

	function handleSubmit() {
		if (inputDisabled || !transcript.trim()) return;
		onSubmit(transcript, selectedModel.provider, selectedModel.model);
	}

	function nodeCount(meeting: Meeting) {
		const n = meeting.map?.nodes?.length ?? 0;
		return `${n} topic${n !== 1 ? 's' : ''}`;
	}

	const hasMeetings = $derived(savedMeetings.length > 0);
</script>

<div class="min-h-screen px-4 py-12">
	<div class="mx-auto max-w-5xl space-y-10">
		<!-- Header -->
		<div class="space-y-2 text-center">
			<h1 class="text-4xl font-semibold tracking-tight">Roundtable</h1>
			<p class="text-zinc-500">Paste or upload a meeting transcript and visualize it as an interactive map.</p>
		</div>

		<div class={hasMeetings ? 'grid grid-cols-1 gap-8 lg:grid-cols-2' : 'mx-auto max-w-2xl'}>
			<!-- New Meeting -->
			<div class="space-y-4">
				<h2 class="text-lg font-medium">New Meeting</h2>

				<Card class="p-5">
					<div class="space-y-4">
						<div class="space-y-2">
							<label for="transcript-file" class="block text-sm font-medium">Upload a transcript</label>
							<input
								id="transcript-file"
								type="file"
								accept={TRANSCRIPT_ACCEPT}
								onchange={handleFileChange}
								disabled={inputDisabled}
								aria-describedby={uploadError ? 'transcript-file-help transcript-file-error' : 'transcript-file-help'}
								aria-invalid={!!uploadError}
								class="block w-full rounded-md text-sm text-zinc-500 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 dark:file:border-zinc-700 dark:file:text-zinc-100"
							/>
							<p id="transcript-file-help" class="text-xs text-zinc-500">
								Supported: .txt, .md, .srt, .vtt (UTF-8 text, up to 5 MB).
								Uploading replaces the text below. Review or edit it before mapping.
							</p>
							<div role="status" class="text-xs text-zinc-500 break-words">
								{#if isReadingFile}
									Reading transcript...
								{:else if uploadedFileName}
									Loaded {uploadedFileName}. Ready to review below.
								{/if}
							</div>
							{#if uploadError}
								<p id="transcript-file-error" role="alert" class="text-sm text-red-600">{uploadError}</p>
							{/if}
						</div>

						<Textarea bind:value={transcript} placeholder="Paste your meeting transcript here, or upload a file above..." rows={10} class="h-52 resize-y" disabled={inputDisabled} />

						<ModelSelect id="meeting-ai-model" bind:value={selectedModelId} disabled={inputDisabled} />

						{#if error}
							<p class="text-sm text-red-600">{error}</p>
						{/if}

						<Button size="lg" class="w-full" onclick={handleSubmit} disabled={inputDisabled || !transcript.trim()}>
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

						<SpeechSettings idPrefix="meeting-speech" bind:provider={sttProvider} bind:language={speechLanguage} disabled={inputDisabled} />

						<div class="space-y-2">
							<h3 class="text-sm font-medium">Start a live meeting</h3>
							<Button variant="outline" size="lg" class="w-full" onclick={() => onStartLive(sttProvider, 'microphone', speechLanguage)} disabled={liveDisabled}>
								<Mic class="h-5 w-5" /> Use microphone
							</Button>
							<Button variant="outline" size="lg" class="w-full" onclick={() => onStartLive(sttProvider, 'tab', speechLanguage)} disabled={liveDisabled}>
								<Monitor class="h-5 w-5" /> Share browser tab audio
							</Button>
							<p class="text-xs leading-relaxed text-zinc-500">Choose your source, then start capture on the next screen. For tab audio, use desktop Chrome or Edge and enable <strong>Share tab audio</strong> in the browser picker.</p>
						</div>
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
