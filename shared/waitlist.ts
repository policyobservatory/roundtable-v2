import { z } from 'zod';

export const WAITLIST_INDUSTRIES = [
	{ value: 'legislature', label: 'Legislature / legislative staff' },
	{ value: 'government', label: 'Government / public administration' },
	{ value: 'legal', label: 'Legal / judiciary' },
	{ value: 'policy-research', label: 'Policy research / think tank' },
	{ value: 'education', label: 'Education / academia' },
	{ value: 'nonprofit', label: 'Nonprofit / civil society' },
	{ value: 'media', label: 'Media / journalism' },
	{ value: 'technology', label: 'Technology' },
	{ value: 'business', label: 'Business / private sector' },
	{ value: 'other', label: 'Other' }
] as const;

export const waitlistSchema = z.object({
	first_name: z.string().trim().min(1, 'Enter your first name.').max(80, 'First name must be 80 characters or fewer.')
		.refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Enter a valid first name.'),
	email: z.string().trim().toLowerCase().max(254, 'Email must be 254 characters or fewer.').email('Enter a valid email address.'),
	industry: z.preprocess(value => value === '' || value === undefined ? null : value,
		z.enum(WAITLIST_INDUSTRIES.map(option => option.value)).nullable()),
	// Basic spam trap; never persisted. Not a replacement for rate limiting/bot verification.
	website: z.string().max(500).optional()
}).strict();

export type WaitlistSignup = z.input<typeof waitlistSchema>;
export const WAITLIST_CONSENT_VERSION = 'launch-discount-v1';
