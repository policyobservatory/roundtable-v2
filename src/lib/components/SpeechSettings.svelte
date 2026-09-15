<script lang="ts">
	import type { STTProvider } from '$shared/types';
	import { DEFAULT_SPEECH_LANGUAGE, DEFAULT_STT_PROVIDER, SPEECH_LANGUAGES, supportsSpeechLanguage, speechLanguageError, type SpeechLanguage } from '$shared/speech-settings';
	import { STT_PROVIDERS } from '$lib/constants';
	import Select from './ui/Select.svelte';
	import InfoTooltip from './ui/InfoTooltip.svelte';

	let { provider = $bindable<STTProvider>(DEFAULT_STT_PROVIDER), language = $bindable<SpeechLanguage>(DEFAULT_SPEECH_LANGUAGE), disabled = false, idPrefix = 'speech' }: {
		provider?: STTProvider; language?: SpeechLanguage; disabled?: boolean; idPrefix?: string;
	} = $props();
	const options = $derived(STT_PROVIDERS.filter((option) => supportsSpeechLanguage(option.value, language)).map((option) => ({ value: option.value, label: option.label })));
</script>

<div class="space-y-2">
	<Select id={`${idPrefix}-language`} label="Conversation language" bind:value={language} options={[...SPEECH_LANGUAGES]} {disabled}
		onchange={() => { if (!supportsSpeechLanguage(provider, language)) provider = DEFAULT_STT_PROVIDER; }}>
		{#snippet help()}
			<InfoTooltip label="Language guidance">
				{#if language === 'fil-en'}
					Whisper with a Tagalog language hint is the recommended starting point for Taglish. It transcribes rather than translates; mixed-language accuracy can still vary. Nova-3’s multilingual mode does not include Tagalog.
				{:else if language === 'auto'}
					Detects the dominant language in each clip, not guaranteed code-switching. For Filipino + English conversations, try the Taglish preset.
				{:else}
					Sends an explicit language hint to the speech model. Use Filipino + English for code-switching.
				{/if}
			</InfoTooltip>
		{/snippet}
	</Select>
	<Select id={`${idPrefix}-model`} label="Speech-to-text model" bind:value={provider} {options} {disabled} />
	{#if speechLanguageError(provider, language)}<p role="alert" class="text-xs text-red-600">{speechLanguageError(provider, language)}</p>{/if}
</div>
