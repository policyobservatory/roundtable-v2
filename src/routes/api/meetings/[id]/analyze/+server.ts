import type { RequestHandler } from './$types';
import { initPlatform, getPlatform } from '$lib/platform';
import { getMeeting } from '$lib/db';
import { getTranscript } from '$lib/storage';
import { runChunkedAnalysis, type AnalysisEvent } from '$lib/analysis';
import { error } from '@sveltejs/kit';
import type { AIProvider } from '$lib/types';

export const POST: RequestHandler = async (event) => {
	const { env } = await initPlatform(event);
	const { id } = event.params;
	const meeting = await getMeeting(env.DB, id);
	if (!meeting) throw error(404, 'Meeting not found');

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const provider: AIProvider = (body.provider as AIProvider) ?? meeting.provider;
	const model: string = (body.model as string) ?? meeting.model;
	const transcript = await getTranscript(env.TRANSCRIPTS, meeting.transcript_key);
	if (!transcript) throw error(404, 'Transcript not found');

	const { readable, writable } = new TransformStream<AnalysisEvent, string>({
		transform(event, controller) {
			controller.enqueue(JSON.stringify(event) + '\n');
		}
	});

	const writer = writable.getWriter();
	const platform = getPlatform(event);

	platform.ctx.waitUntil(
		(async () => {
			try {
				await runChunkedAnalysis(env.DB, id, transcript, provider, model, env, async (e) => {
					await writer.write(e);
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				await writer.write({ type: 'error', message });
			} finally {
				await writer.close();
			}
		})()
	);

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
