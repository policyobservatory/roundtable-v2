import { Hono } from 'hono';
import type { D1Database, R2Bucket, Fetcher } from '@cloudflare/workers-types';
import type { AppEnv } from '../../../shared/env';
import { parseEnv } from '../../../shared/env';
import { migrate } from '../../../shared/db';
import {
	listMeetings,
	createMeeting,
	getMeeting,
	deleteMeeting,
	getChunks,
	insertSegment,
	updateMeeting,
	saveMessage
} from '../../../shared/db';
import { getTranscript, putTranscript, deleteTranscript, appendTranscript, putAudio } from '../../../shared/storage';
import { runChunkedAnalysis, type AnalysisEvent } from '../../../shared/analysis';
import { transcribeAudio } from '../../../shared/stt';
import { chatCompletion } from '../../../shared/ai';
import { searchDocuments } from '../../../shared/docs';
import type { AIProvider, ChatMessage, Meeting, STTProvider } from '../../../shared/types';

interface Env extends AppEnv {
	DB: D1Database;
	TRANSCRIPTS: R2Bucket;
	AUDIO: R2Bucket;
	ASSETS: Fetcher;
}

async function getEnv(rawEnv: Env) {
	const env = parseEnv(rawEnv as unknown as Record<string, unknown>) as Env;
	await migrate(env.DB);
	return env;
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: err.message, stack: err.stack }, 500);
});

app.use('*', async (c, next) => {
	const origin = c.env.APP_ORIGIN;
	c.header('Access-Control-Allow-Origin', origin);
	c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type');
	if (c.req.method === 'OPTIONS') return c.body(null, 204);
	return next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/meetings', async (c) => {
	const env = await getEnv(c.env);
	return c.json(await listMeetings(env.DB));
});

app.post('/api/meetings', async (c) => {
	const env = await getEnv(c.env);
	const body = (await c.req.json()) as Record<string, unknown>;
	const transcript = (body.transcript as string) ?? '';
	const title = (body.title as string)?.trim() || `Meeting ${new Date().toLocaleDateString()}`;
	const provider: AIProvider = (body.provider as AIProvider) ?? 'openrouter';
	const model = (body.model as string) ?? env.OPENROUTER_MODEL;
	const id = crypto.randomUUID();
	const transcriptKey = `transcripts/${id}.txt`;
	await putTranscript(env.TRANSCRIPTS, transcriptKey, transcript);
	const meeting: Meeting = {
		id,
		title,
		status: 'pending',
		provider,
		model,
		transcript_key: transcriptKey,
		segmented: 0,
		metadata: {
			length: transcript.length,
			chunksEstimated: Math.ceil(transcript.length / env.TRANSCRIPT_CHUNK_SIZE)
		},
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};
	await createMeeting(env.DB, meeting);
	return c.json({ id, title, status: meeting.status }, 201);
});

app.get('/api/meetings/:id', async (c) => {
	const env = await getEnv(c.env);
	const id = c.req.param('id');
	const meeting = await getMeeting(env.DB, id);
	if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
	const [transcript, chunks] = await Promise.all([
		getTranscript(env.TRANSCRIPTS, meeting.transcript_key),
		getChunks(env.DB, id)
	]);
	return c.json({ meeting, transcript, chunks });
});

app.delete('/api/meetings/:id', async (c) => {
	const env = await getEnv(c.env);
	const id = c.req.param('id');
	const meeting = await getMeeting(env.DB, id);
	if (meeting) {
		await Promise.all([deleteTranscript(env.TRANSCRIPTS, meeting.transcript_key), deleteMeeting(env.DB, id)]);
	}
	return c.json({ ok: true });
});

app.post('/api/meetings/:id/analyze', async (c) => {
	const env = await getEnv(c.env);
	const id = c.req.param('id');
	const meeting = await getMeeting(env.DB, id);
	if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const provider: AIProvider = (body.provider as AIProvider) ?? meeting.provider;
	const model = (body.model as string) ?? meeting.model;
	const transcript = await getTranscript(env.TRANSCRIPTS, meeting.transcript_key);
	if (!transcript) return c.json({ error: 'Transcript not found' }, 404);

	const { readable, writable } = new TransformStream<AnalysisEvent, string>({
		transform(event, controller) {
			controller.enqueue(JSON.stringify(event) + '\n');
		}
	});
	const writer = writable.getWriter();

	c.executionCtx.waitUntil(
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
});

app.post('/api/segments', async (c) => {
	const env = await getEnv(c.env);
	const body = (await c.req.json()) as Record<string, unknown>;
	const meetingId = body.meeting_id as string;
	const text = (body.text as string) ?? '';
	const audioBase64 = body.audio_base64 as string | undefined;
	const audioMime = (body.audio_mime as string) || 'audio/webm';
	if (!meetingId) return c.json({ error: 'meeting_id required' }, 400);
	const meeting = await getMeeting(env.DB, meetingId);
	if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
	const segmentIndex = (meeting.metadata.segmentCount as number | undefined) ?? 0;
	let audioKey: string | undefined;
	if (audioBase64) {
		const bytes = Uint8Array.from(atob(audioBase64), (c2) => c2.charCodeAt(0));
		audioKey = `audio/${meetingId}/${segmentIndex}.webm`;
		await putAudio(env.AUDIO, audioKey, new Blob([bytes], { type: audioMime }));
	}
	await appendTranscript(env.TRANSCRIPTS, meeting.transcript_key, text);
	const segment = {
		id: crypto.randomUUID(),
		meeting_id: meetingId,
		segment_index: segmentIndex,
		text,
		audio_key: audioKey,
		status: 'transcribed' as const,
		created_at: new Date().toISOString()
	};
	await insertSegment(env.DB, segment);
	const metadata = {
		...meeting.metadata,
		segmentCount: segmentIndex + 1,
		lastSegmentAt: segment.created_at
	};
	await updateMeeting(env.DB, meetingId, {
		segmented: 1,
		metadata,
		status: meeting.status === 'pending' ? 'analyzing' : meeting.status
	});
	return c.json(segment, 201);
});

app.post('/api/stt/:provider', async (c) => {
	const env = await getEnv(c.env);
	const provider = c.req.param('provider') as STTProvider;
	const valid: STTProvider[] = ['huggingface', 'deepgram', 'elevenlabs'];
	if (!valid.includes(provider)) return c.json({ error: 'Invalid STT provider' }, 400);
	const audio = await c.req.blob();
	if (!audio || audio.size === 0) return c.json({ error: 'Missing audio' }, 400);
	return c.json(await transcribeAudio(provider, audio, env));
});

app.post('/api/chat', async (c) => {
	const env = await getEnv(c.env);
	const body = (await c.req.json()) as Record<string, unknown>;
	const messages = (body.messages as ChatMessage[]) ?? [];
	const provider: AIProvider = (body.provider as AIProvider) ?? 'openrouter';
	const model = (body.model as string) ?? env.OPENROUTER_MODEL;
	const meetingId = body.meeting_id as string | undefined;
	const docQuery = body.doc_query as string | undefined;

	const systemParts = [
		'You are a helpful assistant for the Roundtable meeting analysis app. Answer based on the provided transcript and/or policy document context.'
	];

	if (meetingId) {
		const meeting = await getMeeting(env.DB, meetingId);
		if (meeting) {
			const [transcript, chunks] = await Promise.all([
				getTranscript(env.TRANSCRIPTS, meeting.transcript_key),
				getChunks(env.DB, meetingId)
			]);
			if (transcript) systemParts.push(`Meeting transcript:\n${transcript.slice(0, 12000)}`);
			if (chunks.length) systemParts.push(`Chunk summaries:\n${chunks.map((c) => c.summary).join('\n')}`);
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
			// best effort
		}
	}

	const fullMessages: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }, ...messages];
	if (!fullMessages.some((m) => m.role === 'user')) return c.json({ error: 'User message required' }, 400);
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
	return c.json({ content });
});

app.get('/api/docs/search', async (c) => {
	const env = await getEnv(c.env);
	const query = c.req.query('q') ?? '';
	const results = query ? await searchDocuments(query, env) : [];
	return c.json({ query, results });
});

// Serve static frontend assets for non-API routes
app.notFound(async (c) => {
	const asset = c.env.ASSETS;
	if (!asset) return new Response('ASSETS binding not configured', { status: 500 });
	const url = new URL(c.req.url);
	if (!url.pathname.includes('.')) {
		url.pathname = '/';
	}
	const request = new Request(url, c.req.raw);
	const response = await asset.fetch(request as unknown as Parameters<Fetcher['fetch']>[0]);
	return response as unknown as Response;
});

export default app;
