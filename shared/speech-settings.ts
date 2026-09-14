import type { STTProvider } from './types';

export const SPEECH_LANGUAGES = [
	{ value: 'fil-en', label: 'Filipino + English (Taglish)' },
	{ value: 'tl', label: 'Filipino / Tagalog' },
	{ value: 'en', label: 'English' },
	{ value: 'auto', label: 'Auto-detect language' }
] as const;
export type SpeechLanguage = typeof SPEECH_LANGUAGES[number]['value'];
export const DEFAULT_SPEECH_LANGUAGE: SpeechLanguage = 'fil-en';
export const DEFAULT_STT_PROVIDER: STTProvider = 'whisper';
// More acoustic context than five-second clips, at the cost of live latency.
export const LIVE_AUDIO_CHUNK_MS = 12000;

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
	return SPEECH_LANGUAGES.some((option) => option.value === value);
}

export function supportsSpeechLanguage(provider: STTProvider, language: SpeechLanguage) {
	if (language === 'auto' || provider === 'whisper') return true;
	// Nova-3's documented `multi` set does not include Tagalog. Do not claim Taglish support.
	return provider === 'deepgram' && (language === 'en' || language === 'tl');
}

export function speechLanguageError(provider: STTProvider, language: SpeechLanguage) {
	return supportsSpeechLanguage(provider, language) ? ''
		: 'This language preset is not supported by the selected speech model. Choose Cloudflare Whisper, or use Auto-detect language.';
}
