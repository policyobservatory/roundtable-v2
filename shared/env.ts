import { z } from 'zod';

export const appEnvSchema = z.object({
	// Non-secret vars
	APP_ORIGIN: z.string().default('*'),
	TRANSCRIPT_CHUNK_SIZE: z.coerce.number().default(6000),
	WORKERS_AI_MODEL: z.string().default('@cf/meta/llama-3.1-8b-instruct'),
	OPENROUTER_MODEL: z.string().default('openai/gpt-4o-mini'),
	LLMAPI_MODEL: z.string().default('gpt-4o-mini'),
	HF_STT_MODEL: z.string().default('openai/whisper-large-v3'),
	DEEPGRAM_STT_MODEL: z.string().default('nova-2'),
	ELEVENLABS_STT_MODEL: z.string().default('scribe_v1'),
	POLICY_OBSERVATORY_DOCS_URL: z.string().url().default('https://api.policyobservatory.org/v1/docs'),

	// Secrets
	OPENROUTER_API_KEY: z.string().optional(),
	HF_TOKEN: z.string().optional(),
	DEEPGRAM_API_KEY: z.string().optional(),
	ELEVENLABS_API_KEY: z.string().optional(),
	CF_ACCOUNT_ID: z.string().optional(),
	CF_API_TOKEN: z.string().optional(),
	LLMAPI_URL: z.string().url().optional(),
	LLMAPI_KEY: z.string().optional(),
	POLICY_OBSERVATORY_API_KEY: z.string().optional()
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseEnv(env: Record<string, unknown>): AppEnv {
	return appEnvSchema.parse(env);
}
