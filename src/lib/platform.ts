import type { RequestEvent } from '@sveltejs/kit';
import type { AppEnv } from './env';
import { parseEnv } from './env';
import { migrate } from './db';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Platform {
	env: AppEnv & {
		DB: D1Database;
		TRANSCRIPTS: R2Bucket;
		AUDIO: R2Bucket;
	};
	ctx: ExecutionContext;
	caches: CacheStorage;
	cf?: IncomingRequestCfProperties;
}

export function getPlatform(event: RequestEvent): Platform {
	const platform = event.platform as unknown as Platform | undefined;
	if (!platform?.env?.DB || !platform?.env?.TRANSCRIPTS) {
		throw new Error('Cloudflare bindings unavailable. Run with wrangler pages dev or deploy to Cloudflare.');
	}
	// Parse/validate env values (vars + secrets)
	const parsed = parseEnv(platform.env as unknown as Record<string, unknown>);
	return {
		...platform,
		env: { ...platform.env, ...parsed }
	};
}

export async function initPlatform(event: RequestEvent): Promise<Platform> {
	const platform = getPlatform(event);
	await migrate(platform.env.DB);
	return platform;
}
