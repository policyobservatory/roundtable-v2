import type { AIProvider } from '../../shared/types';
import { DEFAULT_WORKERS_AI_MODEL } from '../../shared/ai-defaults.ts';

interface AIModelOption {
	id: string;
	label: string;
	provider: AIProvider;
	model: string;
	description: string;
}

// Add models here to show them in every AI model dropdown.
// Use unique IDs. The first entry is the default; configure provider credentials separately.
export const AI_MODELS = [
	{
		id: 'workers-glm-5-3-flash',
		label: 'GLM-5.3 Flash · Cloudflare',
		provider: 'workers-ai',
		model: DEFAULT_WORKERS_AI_MODEL,
		description: ''
	},
	{
		id: 'openrouter-gpt-4o-mini',
		label: 'GPT-4o mini · OpenRouter',
		provider: 'openrouter',
		model: 'openai/gpt-4o-mini',
		description: 'A fast, lightweight model for everyday meetings.'
	},
	{
		id: 'workers-llama-3-1',
		label: 'Llama 3.1 8B · Cloudflare',
		provider: 'workers-ai',
		model: '@cf/meta/llama-3.1-8b-instruct',
		description: 'An open-source model served by Cloudflare Workers AI.'
	},
	{
		id: 'llmapi-gpt-4o-mini',
		label: 'GPT-4o mini · LLMApi',
		provider: 'llmapi',
		model: 'gpt-4o-mini',
		description: 'Uses your configured OpenAI-compatible endpoint.'
	}
] satisfies [AIModelOption, ...AIModelOption[]];

export const DEFAULT_AI_MODEL = AI_MODELS[0];

export function getAIModel(id: string) {
	return AI_MODELS.find((option) => option.id === id) ?? DEFAULT_AI_MODEL;
}

export const STT_PROVIDERS = [
	{ value: 'deepgram', label: 'Deepgram Nova-3 · Cloudflare', defaultModel: '@cf/deepgram/nova-3' },
	{ value: 'whisper', label: 'Whisper Large v3 Turbo · Cloudflare', defaultModel: '@cf/openai/whisper-large-v3-turbo' },
	{ value: 'elevenlabs', label: 'ElevenLabs', defaultModel: 'scribe_v1' },
	{ value: 'huggingface', label: 'Hugging Face', defaultModel: 'openai/whisper-large-v3' }
] as const;
