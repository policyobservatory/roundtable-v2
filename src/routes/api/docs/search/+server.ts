import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { searchDocuments } from '$lib/docs';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const query = event.url.searchParams.get('q') ?? '';
	const results = query ? await searchDocuments(query, env) : [];
	return json({ query, results });
};
