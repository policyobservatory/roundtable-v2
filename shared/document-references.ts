export interface DocumentResult {
	id: string;
	title: string;
	content: string;
	url: string;
	bill_id?: string;
	bill_url?: string;
	source_url?: string;
	bill_title?: string;
	bill_status?: string;
}

export function safeDocumentUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; }
	catch { return undefined; }
}

export type ReferenceStatus = 'pending' | 'queued' | 'searching' | 'ready' | 'empty' | 'error';
export interface DocumentReference {
	id: string;
	fingerprint: string;
	generation: number;
	status: ReferenceStatus;
	documents: DocumentResult[];
	error?: string;
	updated_at: string;
}
export interface ReferenceTopic { id: string; title: string; summary: string }
export interface ReferenceAssignment { revision: string; reference: DocumentReference }
export interface ReferenceMessage { jobId: string; generation: number }

/** IDs/layouts are excluded so identical live/final cards reuse results within a meeting. */
export function referenceRevision(topic: Pick<ReferenceTopic, 'title' | 'summary'>) {
	const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
	return JSON.stringify([normalize(topic.title), normalize(topic.summary)]);
}
export function referenceQuery(topic: Pick<ReferenceTopic, 'title' | 'summary'>) {
	return [topic.title.trim(), topic.summary.trim()].filter(Boolean).join('. ').replace(/\s+/g, ' ').slice(0, 500);
}
export async function referenceFingerprint(topic: Pick<ReferenceTopic, 'title' | 'summary'>) {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(referenceRevision(topic)));
	return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function referencePending(reference?: DocumentReference) {
	return !!reference && ['pending', 'queued', 'searching'].includes(reference.status);
}
/** Only expose safe links from successful searches; status is displayed separately. */
export function linkedDocuments(reference?: DocumentReference): DocumentResult[] {
	if (reference?.status !== 'ready') return [];
	return reference.documents.filter((document) => safeDocumentUrl(document.source_url) || safeDocumentUrl(document.url) || safeDocumentUrl(document.bill_url));
}
export function referenceStatusText(reference?: DocumentReference) {
	if (!reference) return 'Waiting to queue document search…';
	if (reference.status === 'error') return 'Document search failed';
	if (reference.status === 'empty') return 'No matching documents found';
	if (reference.status === 'searching') return 'Searching Policy Observatory…';
	if (reference.status === 'pending' && reference.error) return 'Document search interrupted; retrying…';
	if (referencePending(reference)) return 'Document search queued…';
	return linkedDocuments(reference).length ? referenceLabel(reference) : 'No usable document links returned';
}
export function referenceLabel(reference?: DocumentReference) {
	const count = linkedDocuments(reference).length;
	return count ? `${count} related provision${count === 1 ? '' : 's'}` : '';
}
