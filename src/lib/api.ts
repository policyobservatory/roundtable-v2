import type { AIProvider, Meeting, MeetingMap, Segment, STTProvider, TranscriptSegment } from '$shared/types';
import type { AnalysisEvent } from '$shared/analysis';
import type { SpeechLanguage } from '$shared/speech-settings';
import type { ReferenceTopic, ReferenceAssignment, DocumentReference } from '$shared/document-references';

const base = '';

export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) { super(message); this.status = status; }
}

async function api(path: string, options?: RequestInit) {
	const res = await fetch(`${base}${path}`, {
		...options,
		headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) }
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
		throw new ApiError(err.error || `Request failed: ${res.status}`, res.status);
	}
	return res;
}

export async function listMeetings(): Promise<Meeting[]> {
	const res = await api('/api/meetings');
	return res.json();
}

export async function createMeeting(data: {
	title?: string;
	transcript: string;
	provider: AIProvider;
	model: string;
}) {
	const res = await api('/api/meetings', {
		method: 'POST',
		body: JSON.stringify(data)
	});
	return res.json() as Promise<{ id: string; title: string; status: string }>;
}

export async function getMeeting(id: string) {
	const res = await api(`/api/meetings/${id}`);
	return res.json() as Promise<{ meeting: Meeting; transcript: string; baseTranscript?: string; segments?: TranscriptSegment[]; chunks: unknown[] }>;
}

export async function deleteMeeting(id: string) {
	const res = await api(`/api/meetings/${id}`, { method: 'DELETE' });
	return res.json();
}

export async function* analyzeMeeting(
	id: string,
	provider: AIProvider,
	model: string
): AsyncGenerator<AnalysisEvent> {
	const res = await api(`/api/meetings/${id}/analyze`, {
		method: 'POST',
		body: JSON.stringify({ provider, model })
	});
	const reader = res.body?.getReader();
	if (!reader) throw new Error('Stream not available');
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (line.trim()) yield JSON.parse(line) as AnalysisEvent;
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) yield JSON.parse(buffer) as AnalysisEvent;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function transcribe(provider: STTProvider, blob: Blob, language: SpeechLanguage = 'auto') {
	const res = await fetch(`/api/stt/${provider}?language=${encodeURIComponent(language)}`, {
		method: 'POST',
		body: blob
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
		throw new Error(err.error || `STT failed: ${res.status}`);
	}
	return res.json() as Promise<{ text: string }>;
}

export async function queueDocumentReferences(meetingId: string, nodes: ReferenceTopic[], retry: boolean, signal: AbortSignal) {
	const res = await api(`/api/meetings/${encodeURIComponent(meetingId)}/references`, {
		method: 'POST', body: JSON.stringify({ nodes, retry }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
	});
	return ((await res.json()) as { references: ReferenceAssignment[] }).references;
}

export async function pollDocumentReferences(meetingId: string, fingerprints: string[], signal: AbortSignal) {
	const res = await api(`/api/meetings/${encodeURIComponent(meetingId)}/references?fingerprints=${fingerprints.join(',')}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
	});
	return ((await res.json()) as { references: DocumentReference[] }).references;
}

export async function chat(data: {
	messages: { role: string; content: string }[];
	provider: AIProvider;
	model: string;
	meeting_id?: string;
	doc_query?: string;
}) {
	const res = await api('/api/chat', {
		method: 'POST',
		body: JSON.stringify(data)
	});
	return res.json() as Promise<{ content: string }>;
}

export async function appendSegment(data: Pick<Segment, 'id' | 'meeting_id' | 'segment_index' | 'text' | 'created_at'>) {
	// The same ID and payload are reused even if the response was lost after a successful write.
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await api('/api/segments', { method: 'POST', body: JSON.stringify(data) });
			return await res.json();
		} catch (err) {
			const retryable = err instanceof TypeError || (err instanceof ApiError && [502, 503, 504].includes(err.status));
			if (!retryable || attempt >= 2) throw err;
			await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
		}
	}
}

export async function previewLiveMap(text: string, previous: MeetingMap, provider: AIProvider, model: string, signal?: AbortSignal): Promise<MeetingMap> {
	const res = await api('/api/live-map', { method: 'POST', signal, body: JSON.stringify({ text, previous, provider, model }) });
	return res.json();
}
