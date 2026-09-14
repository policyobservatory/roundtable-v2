export const AI_PROVIDERS = [
	{ value: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4o-mini' },
	{ value: 'workers-ai', label: 'Cloudflare Workers AI', defaultModel: '@cf/meta/llama-3.1-8b-instruct' },
	{ value: 'llmapi', label: 'LLMApi (OpenAI-compatible)', defaultModel: 'gpt-4o-mini' }
] as const;

export const STT_PROVIDERS = [
	{ value: 'deepgram', label: 'Deepgram', defaultModel: 'nova-2' },
	{ value: 'elevenlabs', label: 'ElevenLabs', defaultModel: 'scribe_v1' },
	{ value: 'huggingface', label: 'Hugging Face', defaultModel: 'openai/whisper-large-v3' }
] as const;
