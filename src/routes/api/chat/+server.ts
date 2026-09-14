import type { RequestHandler } from './$types';
import { initPlatform } from '$lib/platform';
import { getMeeting, getChunks, saveMessage } from '$lib/db';
import { getTranscript } from '$lib/storage';
import { chatCompletion } from '$lib/ai';
import { searchDocuments } from '$lib/docs';
import type { AIProvider, ChatMessage } from '$lib/types';
import { json, error } from '@sveltejs/kit';

export const POST: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const body = (await event.request.json()) as Record<string, unknown>;
	const messages: ChatMessage[] = (body.messages as ChatMessage[]) ?? [];
	const provider: AIProvider = (body.provider as AIProvider) ?? 'openrouter';
	const model: string = (body.model as string) ?? env.OPENROUTER_MODEL;
	const meetingId: string | undefined = body.meeting_id as string | undefined;
	const docQuery: string | undefined = body.doc_query as string | undefined;

	const systemParts: string[] = [
		'You are a helpful assistant for the Roundtable meeting analysis app. Answer based on the provided transcript and/or policy document context.'
	];

	if (meetingId) {
		const meeting = await getMeeting(env.DB, meetingId);
		if (meeting) {
			const [transcript, chunks] = await Promise.all([
				getTranscript(env.TRANSCRIPTS, meeting.transcript_key),
				getChunks(env.DB, meetingId)
			]);
			if (transcript) {
				systemParts.push(`Meeting transcript:\n${transcript.slice(0, 12000)}`);
			}
			if (chunks.length) {
				systemParts.push(`Chunk summaries:\n${chunks.map((c) => c.summary).join('\n')}`);
			}
		}
	}

	if (docQuery) {
		try {
			const docs = await searchDocuments(docQuery, env);
			if (docs.length) {
				systemParts.push(
					`Relevant policy documents:\n${docs.map((d) => `Title: ${d.title}\n${d.content}`).join('\n---\n')}`
				);
			}
		} catch {
			// Document search is best-effort
		}
	}

	const fullMessages: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }, ...messages];

	if (!fullMessages.some((m) => m.role === 'user')) {
		throw error(400, 'At least one user message is required');
	}

	const content = await chatCompletion(fullMessages, provider, model, env, { temperature: 0.7 });

	const userContent = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
	await saveMessage(env.DB, {
		id: crypto.randomUUID(),
		meeting_id: meetingId,
		role: 'user',
		content: userContent,
		provider,
		model,
		created_at: new Date().toISOString()
	});
	await saveMessage(env.DB, {
		id: crypto.randomUUID(),
		meeting_id: meetingId,
		role: 'assistant',
		content,
		provider,
		model,
		created_at: new Date().toISOString()
	});

	return json({ content });
};
