<script lang="ts">
	import { Loader2, Mic, Monitor, Trash2, ChevronRight, Upload, FileText } from '@lucide/svelte';
	import type { AudioSource } from '$lib/live-audio';
	import type { AIProvider, Meeting, STTProvider } from '$shared/types';
	import { DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';
	import { DEFAULT_SPEECH_LANGUAGE, DEFAULT_STT_PROVIDER, speechLanguageError, type SpeechLanguage } from '$shared/speech-settings';
	import SpeechSettings from '$lib/components/SpeechSettings.svelte';
	import ModelSelect from '$lib/components/ModelSelect.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import SiteFooter from './SiteFooter.svelte';
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

	const modes = [
		{ value: 'live', label: 'Live meeting', icon: Mic },
		{ value: 'transcript', label: 'Transcript', icon: FileText }
	] as const;
	let mode = $state<'live' | 'transcript'>('live');
	let fileInput: HTMLInputElement;
	let transcript = $state('');
	let isReadingFile = $state(false);
	let uploadError = $state('');
	let uploadedFileName = $state('');
	let inputDisabled = $derived(isLoading || isReadingFile);

	function handleTabKey(event: KeyboardEvent, index: number) {
		if (inputDisabled) return;
		let next: number;
		if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
		else if (event.key === 'ArrowLeft') next = (index + modes.length - 1) % modes.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = modes.length - 1;
		else return;
		event.preventDefault();
		mode = modes[next].value;
		const tab = event.currentTarget as HTMLButtonElement;
		tab.parentElement?.querySelector<HTMLButtonElement>(`#input-tab-${mode}`)?.focus();
	}

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

<div class="flex min-h-screen flex-col bg-background">
	<header class="mx-auto flex w-full max-w-[1168px] items-center justify-between gap-4 px-6 py-4">
		<span class="font-serif text-[22px] tracking-[-0.01em]">Roundtable</span>
		<ThemeToggle />
	</header>
	<main class="flex flex-1 flex-col">
		<section aria-labelledby="workspace-heading" class="mx-auto max-w-[1168px] px-6 pb-6 pt-2">
			<h1 id="workspace-heading" class="font-serif text-2xl font-normal leading-tight tracking-[-0.02em] sm:text-3xl">Meetings, kept in context.</h1>
			<p class="mt-2 text-sm leading-relaxed text-muted">Record a live discussion or work from an existing transcript.</p>
		</section>

		<div id="meeting-workspace" class="flex-1 border-t border-border bg-surface">
			<div class="mx-auto max-w-[1168px] px-6 py-6 sm:py-8">
				<div class={hasMeetings ? 'grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]' : 'mx-auto max-w-2xl'}>
					<section aria-labelledby="new-meeting-heading" class="min-w-0 space-y-4">
						<h2 id="new-meeting-heading" class="font-serif text-2xl font-normal leading-tight">New Meeting</h2>
						<div role="tablist" aria-label="Meeting input mode" class="flex border-b border-border">
							{#each modes as option, index}
								<button
									type="button"
									role="tab"
									id={`input-tab-${option.value}`}
									aria-selected={mode === option.value}
									aria-controls={`input-panel-${option.value}`}
									tabindex={mode === option.value ? 0 : -1}
									disabled={inputDisabled}
									onclick={() => mode = option.value}
									onkeydown={event => handleTabKey(event, index)}
									class="inline-flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-50 {mode === option.value ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:bg-surface-muted'}"
								>
									<option.icon class="h-4 w-4" aria-hidden="true" />{option.label}
								</button>
							{/each}
						</div>

						{#if error}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>{/if}

						<div id="input-panel-live" role="tabpanel" aria-labelledby="input-tab-live" hidden={mode !== 'live'} class="space-y-4">
							<SpeechSettings idPrefix="meeting-speech" bind:provider={sttProvider} bind:language={speechLanguage} disabled={inputDisabled} />
							<div class="space-y-2">
								<Button size="lg" class="w-full" onclick={() => onStartLive(sttProvider, 'microphone', speechLanguage)} disabled={liveDisabled}>
									<Mic class="h-5 w-5" /> Use microphone
								</Button>
								<Button variant="outline" size="lg" class="w-full" onclick={() => onStartLive(sttProvider, 'tab', speechLanguage)} disabled={liveDisabled}>
									<Monitor class="h-5 w-5" /> Share browser tab audio
								</Button>
								<p class="text-xs leading-relaxed text-muted">Choose your source, then start capture on the next screen. For tab audio, use desktop Chrome or Edge and enable <strong>Share tab audio</strong> in the browser picker.</p>
							</div>
						</div>

						<div id="input-panel-transcript" role="tabpanel" aria-labelledby="input-tab-transcript" hidden={mode !== 'transcript'} class="space-y-4">
							<div class="space-y-2">
								<label for="meeting-transcript" class="block text-sm font-medium">Meeting transcript</label>
								<Textarea id="meeting-transcript" bind:value={transcript} placeholder="Paste your meeting transcript here, or upload a file below..." rows={8} class="h-44 resize-y" disabled={inputDisabled} />
							</div>
							<div class="space-y-2">
								<input bind:this={fileInput} id="transcript-file" type="file" accept={TRANSCRIPT_ACCEPT} onchange={handleFileChange} disabled={inputDisabled} aria-label="Transcript file" hidden />
								<Button variant="outline" size="lg" class="w-full" onclick={() => fileInput?.click()} disabled={inputDisabled}>
									{#if isReadingFile}<Loader2 class="h-4 w-4 animate-spin" /> Reading transcript...{:else}<Upload class="h-4 w-4" /> Upload a transcript{/if}
								</Button>
								<p class="text-xs leading-relaxed text-muted">.txt, .md, .srt, .vtt · UTF-8 · up to 5 MB. Uploading replaces the text above; review it before mapping.</p>
								<div role="status" class="text-xs text-muted break-words">
									{#if isReadingFile}Reading transcript...{:else if uploadedFileName}Loaded {uploadedFileName}. Ready to review above.{/if}
								</div>
								{#if uploadError}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{uploadError}</p>{/if}
							</div>
							<ModelSelect id="meeting-ai-model" bind:value={selectedModelId} disabled={inputDisabled} />
							<Button size="lg" class="w-full" onclick={handleSubmit} disabled={inputDisabled || !transcript.trim()}>
								{#if isLoading}
									<Loader2 class="h-4 w-4 animate-spin" />
									{#if progress && progress.total > 1}Analyzing chunk {progress.processed} of {progress.total}...{:else}Analyzing...{/if}
								{:else}Map this meeting{/if}
							</Button>
						</div>
					</section>

					{#if hasMeetings}
						<section aria-labelledby="past-meetings-heading" class="min-w-0 space-y-4">
							<h2 id="past-meetings-heading" class="font-serif text-2xl font-normal leading-tight">Past Meetings</h2>
							<div class="max-h-[28rem] divide-y divide-border overflow-y-auto border-y border-border">
								{#each savedMeetings as meeting}
									<div class="group flex items-center gap-2">
										<button type="button" class="flex min-w-0 flex-1 items-center gap-3 px-1 py-5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" onclick={() => onOpen(meeting)}>
											<div class="min-w-0 flex-1">
												<p class="truncate font-serif text-xl leading-snug">{meeting.title}</p>
												<div class="mt-1 flex items-center gap-2 text-xs text-muted">
													<span>{timeAgo(meeting.created_at)}</span><span aria-hidden="true">·</span><span>{nodeCount(meeting)}</span>
												</div>
											</div>
											<ChevronRight class="h-4 w-4 shrink-0 text-muted" />
										</button>
										<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0 text-muted sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100" onclick={() => onDelete(meeting.id)} title="Delete"><Trash2 class="h-4 w-4" /></Button>
									</div>
								{/each}
							</div>
						</section>
					{/if}
				</div>
			</div>
		</div>
	</main>
	<SiteFooter />
</div>
