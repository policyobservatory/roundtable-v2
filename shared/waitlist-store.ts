import type { D1Database } from '@cloudflare/workers-types';
import { retryIdempotent } from './retry';
import { WAITLIST_CONSENT_VERSION, waitlistSchema } from './waitlist';
import type { z } from 'zod';

export async function saveWaitlistSignup(db: D1Database, signup: z.output<typeof waitlistSchema>): Promise<void> {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	// Never overwrite an existing subscriber through this unauthenticated endpoint.
	// The unique email also makes retries safe after an ambiguous acknowledgement.
	await retryIdempotent(async () => {
		const result = await db.prepare(`
			INSERT INTO waitlists (id, first_name, email, industry, consent_version, created_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6)
			ON CONFLICT(email) DO NOTHING
		`).bind(id, signup.first_name, signup.email, signup.industry, WAITLIST_CONSENT_VERSION, createdAt).run();
		if (!result.success) throw new Error('Waitlist write failed');
	});
}
