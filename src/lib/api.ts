import type { AIProvider, Meeting, STTProvider } from '$shared/types';
import type { AnalysisEvent } from '$shared/analysis';

const base = '';

async function api(path: string, options?: RequestInit) {
	const res = await fetch(`${base}${path}`, {
		...options,
		headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) }
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
		throw new Error(err.error || `Request failed: ${res.status}`);
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
	return res.json() as Promise<{ meeting: Meeting; transcript: string; chunks: unknown[] }>;
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
	if (buffer.trim()) yield JSON.parse(buffer) as AnalysisEvent;
}

export async function transcribe(provider: STTProvider, blob: Blob) {
	const res = await fetch(`/api/stt/${provider}`, {
		method: 'POST',
		body: blob
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
		throw new Error(err.error || `STT failed: ${res.status}`);
	}
	return res.json() as Promise<{ text: string }>;
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

export async function appendSegment(data: {
	meeting_id: string;
	text: string;
}) {
	const res = await api('/api/segments', {
		method: 'POST',
		body: JSON.stringify(data)
	});
	return res.json();
}
