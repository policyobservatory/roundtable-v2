import type { AppEnv } from './env';
import { insertChunk, updateMeeting } from './db';
import type { D1Database } from '@cloudflare/workers-types';
import { analyzeChunk, buildFinalMap, parseAnalysisJson } from './ai';
import type { AIProvider, MeetingMap, MeetingNode } from './types';

export function splitTranscript(text: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + chunkSize, text.length);
		if (end < text.length) {
			const lastBreak = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
			if (lastBreak > start + chunkSize * 0.5) end = lastBreak + 1;
		}
		chunks.push(text.slice(start, end).trim());
		start = end;
	}
	return chunks.filter((c) => c.length > 0);
}

export type AnalysisEvent =
	| { type: 'progress'; processed: number; total: number }
	| { type: 'chunk'; chunkIndex: number; summary: string; nodes: MeetingNode[] }
	| { type: 'complete'; map: MeetingMap }
	| { type: 'error'; message: string };

export async function runChunkedAnalysis(
	db: D1Database,
	meetingId: string,
	transcript: string,
	provider: AIProvider,
	model: string,
	env: AppEnv,
	onEvent: (event: AnalysisEvent) => void | Promise<void>
): Promise<void> {
	const chunks = splitTranscript(transcript, env.TRANSCRIPT_CHUNK_SIZE);
	if (chunks.length === 0) {
		await onEvent({ type: 'error', message: 'Transcript is empty' });
		return;
	}

	await updateMeeting(db, meetingId, { status: 'analyzing', error: undefined });

	const results: { summary: string; nodes: MeetingNode[] }[] = [];
	let contextSummary = '';

	try {
		for (let i = 0; i < chunks.length; i++) {
			await onEvent({ type: 'progress', processed: i, total: chunks.length });
			const result = await analyzeChunk(chunks[i], provider, model, env, contextSummary);
			results.push(result);
			contextSummary = result.summary;

			await insertChunk(db, {
				id: `${meetingId}:${i}`,
				meeting_id: meetingId,
				chunk_index: i,
				start_offset: i * env.TRANSCRIPT_CHUNK_SIZE,
				end_offset: Math.min((i + 1) * env.TRANSCRIPT_CHUNK_SIZE, transcript.length),
				summary: result.summary,
				nodes: result.nodes,
				created_at: new Date().toISOString()
			});

			await onEvent({ type: 'chunk', chunkIndex: i, summary: result.summary, nodes: result.nodes });
		}

		const finalMap = buildFinalMap(results);
		await updateMeeting(db, meetingId, { status: 'completed', map: finalMap, error: undefined });
		await onEvent({ type: 'complete', map: finalMap });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		try { await updateMeeting(db, meetingId, { status: 'error', error: message }); }
		catch { /* Preserve the original error if D1 is still unavailable. */ }
		await onEvent({ type: 'error', message });
	}
}

export { parseAnalysisJson, buildFinalMap };
