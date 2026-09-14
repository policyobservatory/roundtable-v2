import type { AppEnv } from './env';

export interface DocumentResult {
	id: string;
	title: string;
	content: string;
	url?: string;
}

export async function searchDocuments(query: string, env: AppEnv): Promise<DocumentResult[]> {
	const url = new URL(env.POLICY_OBSERVATORY_DOCS_URL);
	url.searchParams.set('q', query);
	const headers: Record<string, string> = {};
	if (env.POLICY_OBSERVATORY_API_KEY) {
		headers.Authorization = `Bearer ${env.POLICY_OBSERVATORY_API_KEY}`;
	}
	const res = await fetch(url.toString(), { headers });
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Document API error ${res.status}: ${err}`);
	}
	// Normalize several possible shapes
	const data = (await res.json()) as
		| DocumentResult[]
		| { results?: DocumentResult[]; data?: DocumentResult[] }
		| undefined;
	if (Array.isArray(data)) return data;
	return data?.results ?? data?.data ?? [];
}
