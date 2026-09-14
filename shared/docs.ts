import { z } from 'zod';
import type { AppEnv } from './env';
import { safeDocumentUrl, type DocumentResult } from './document-references.ts';
export type { DocumentResult } from './document-references';

const provisionSchema = z.object({
	meta: z.object({ section_id: z.string().min(1), bill_id: z.string().min(1), section_title: z.string().default(''), section_number: z.number().optional() }),
	body: z.string()
});
const searchSchema = z.object({ items: z.array(provisionSchema) });
const billSchema = z.object({ title_full: z.string().optional(), title_short: z.string().optional(), text_as_filed: z.string().optional(), status: z.string().optional() });

export class DocumentApiError extends Error {
	retryable: boolean;
	constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; }
}

/** Accept the old /docs configuration too: that path is Swagger UI, NOT a search API. */
export function documentApiBase(env: AppEnv) {
	const url = new URL(env.POLICY_OBSERVATORY_DOCS_URL);
	url.pathname = url.pathname.replace(/\/(?:docs|provisions|bills)\/?$/, '').replace(/\/$/, '') + '/';
	url.search = ''; url.hash = '';
	return url;
}

async function requestJson(url: URL, env: AppEnv): Promise<unknown> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (env.POLICY_OBSERVATORY_API_KEY) headers['X-API-Key'] = env.POLICY_OBSERVATORY_API_KEY;
	let response: Response;
	try { response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); }
	catch { throw new DocumentApiError('Policy Observatory could not be reached or timed out.', true); }
	if (!response.ok) {
		await response.body?.cancel();
		throw new DocumentApiError(`Policy Observatory search returned HTTP ${response.status}.`, response.status === 429 || response.status === 408 || response.status >= 500);
	}
	if (!response.headers.get('Content-Type')?.includes('application/json')) {
		await response.body?.cancel();
		throw new DocumentApiError('Policy Observatory returned a non-JSON response. Check the API base URL.', false);
	}
	// Bound external content even if the server ignores our result limit.
	const reader = response.body?.getReader();
	if (!reader) throw new DocumentApiError('Policy Observatory returned an empty response.', true);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 1024 * 1024) throw new DocumentApiError('Policy Observatory response exceeded the size limit.', false);
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch (error) {
		if (error instanceof DocumentApiError) throw error;
		throw new DocumentApiError('Policy Observatory returned unreadable JSON.', true);
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function searchDocuments(query: string, env: AppEnv): Promise<DocumentResult[]> {
	const text = query.trim().slice(0, 500);
	if (!text) return [];
	const base = documentApiBase(env);
	const url = new URL('provisions', base);
	url.searchParams.set('query', text);
	url.searchParams.set('limit', '5');
	const parsed = searchSchema.safeParse(await requestJson(url, env));
	if (!parsed.success) throw new DocumentApiError('Policy Observatory returned an unexpected search format.', false);
	const documents: DocumentResult[] = parsed.data.items.slice(0, 5).map(({ meta, body }) => ({
		id: meta.section_id,
		title: `${meta.bill_id} · ${meta.section_title || `Section ${meta.section_number ?? ''}`}`.slice(0, 500),
		content: body.slice(0, 2000),
		url: new URL(`provisions/${encodeURIComponent(meta.section_id)}`, base).href,
		bill_id: meta.bill_id,
		bill_url: new URL(`bills/${encodeURIComponent(meta.bill_id)}`, base).href
	}));
	// Bill metadata adds original PDF links/status. Its failure must not hide valid provisions.
	const bills = [...new Set(documents.map((doc) => doc.bill_id!))];
	for (let i = 0; i < bills.length; i += 2) {
		await Promise.all(bills.slice(i, i + 2).map(async (id) => {
			try {
				const result = billSchema.parse(await requestJson(new URL(`bills/${encodeURIComponent(id)}`, base), env));
				for (const doc of documents.filter((doc) => doc.bill_id === id)) {
					doc.source_url = safeDocumentUrl(result.text_as_filed);
					doc.bill_title = (result.title_short || result.title_full)?.slice(0, 500);
					doc.bill_status = result.status?.slice(0, 300);
				}
			} catch { /* Provision record links remain available. */ }
		}));
	}
	return documents;
}
