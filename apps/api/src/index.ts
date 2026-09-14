import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { liveMapSchema, flattenMap } from '../../../shared/meeting-map';
import { ensureDocumentJobs, getDocumentReferences, dispatchDocumentJobs, consumeDocumentJobs } from '../../../shared/document-jobs';
import type { ReferenceMessage } from '../../../shared/document-references';
import type { D1Database, R2Bucket, Fetcher } from '@cloudflare/workers-types';
import type { AppEnv } from '../../../shared/env';
import { parseEnv } from '../../../shared/env';
import { readMeetingTranscript } from '../../../shared/meeting-transcript';
import { isTransientError } from '../../../shared/retry';
import {
	listMeetings,
	createMeeting,
	getMeeting,
	deleteMeeting,
	getChunks,
	saveSegment,
	findSegment,
	saveMessage
} from '../../../shared/db';
import { putTranscript, deleteTranscript } from '../../../shared/storage';
import { runChunkedAnalysis } from '../../../shared/analysis';
import { transcribeAudio } from '../../../shared/stt';
import { isSpeechLanguage, speechLanguageError } from '../../../shared/speech-settings';
import { chatCompletion, analyzeLiveMap } from '../../../shared/ai';
import { searchDocuments } from '../../../shared/docs';
import type { AIProvider, ChatMessage, Meeting, STTProvider } from '../../../shared/types';

interface Env extends Omit<AppEnv, 'AI'>, Pick<Cloudflare.Env, 'AI'> {
	DB: D1Database;
	DOCUMENT_QUEUE: Queue<ReferenceMessage>;
	TRANSCRIPTS: R2Bucket;
	AUDIO: R2Bucket;
	ASSETS: Fetcher;
}

async function getEnv(rawEnv: Env) {
	const env = parseEnv(rawEnv as unknown as Record<string, unknown>) as Env;
	return env;
}

export const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	console.error(JSON.stringify({ event: 'api_error', path: c.req.path, message: err.message }));
	return c.json({ error: err.message, retryable: isTransientError(err) }, isTransientError(err) ? 503 : 500);
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
	const provider: AIProvider = (body.provider as AIProvider) ?? 'workers-ai';
	const model = (body.model as string) ?? (provider === 'workers-ai' ? env.WORKERS_AI_MODEL : provider === 'llmapi' ? env.LLMAPI_MODEL : env.OPENROUTER_MODEL);
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
			segmentStorage: 'd1',
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
		readMeetingTranscript(env.DB, env.TRANSCRIPTS, meeting),
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
	const transcript = await readMeetingTranscript(env.DB, env.TRANSCRIPTS, meeting);
	if (!transcript) return c.json({ error: 'Transcript not found' }, 404);

	c.header('Content-Type', 'application/x-ndjson');
	c.header('Cache-Control', 'no-cache');
	return stream(c, async (output) => {
		try {
			await runChunkedAnalysis(env.DB, id, transcript, provider, model, env, async (event) => {
				if (event.type === 'complete' && env.DOCUMENT_QUEUE) {
					// Persist final-card jobs without waiting for external searches or holding up the stream.
					c.executionCtx.waitUntil(ensureDocumentJobs(env, id, flattenMap(event.map).nodes).catch(() => {
						console.warn(JSON.stringify({ event: 'final_document_jobs_deferred', meetingId: id }));
					}));
				}
				if (output.aborted) throw new Error('Analysis client disconnected');
				await output.write(JSON.stringify(event) + '\n');
			});
		} catch (err) {
			if (!output.aborted) await output.write(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }) + '\n');
		}
	});
});

const segmentSchema = z.object({
	id: z.string().uuid(), meeting_id: z.string().uuid(),
	segment_index: z.number().int().min(0), text: z.string().trim().min(1).max(50000),
	created_at: z.string().datetime()
});

app.post('/api/segments', async (c) => {
	const env = await getEnv(c.env);
	const parsed = segmentSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: 'Invalid segment. Reload Roundtable if this tab is running an older version.' }, 400);
	const body = parsed.data;
	const meeting = await getMeeting(env.DB, body.meeting_id);
	if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
	if (meeting.metadata.segmentStorage !== 'd1') return c.json({ error: 'This older meeting cannot accept new audio. Start a new live meeting.' }, 409);
	const existing = await findSegment(env.DB, body.id);
	if (existing && (existing.meeting_id !== body.meeting_id || existing.text !== body.text || existing.segment_index !== body.segment_index)) {
		return c.json({ error: 'Segment ID already used for different content' }, 409);
	}
	const segment = { ...body, status: 'transcribed' as const };
	await saveSegment(env.DB, segment);
	return c.json(existing ?? segment, existing ? 200 : 201);
});

const liveAnalysisSchema = z.object({
	text: z.string().trim().min(1).max(12000), previous: liveMapSchema,
	provider: z.enum(['openrouter', 'workers-ai', 'llmapi']), model: z.string().min(1).max(200)
});

// Preview analysis is stateless: D1 availability must not block the live canvas.
app.post('/api/live-map', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
	const parsed = liveAnalysisSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: 'Invalid live map request' }, 400);
	const { text, previous, provider, model } = parsed.data;
	const env = await getEnv(c.env);
	return c.json(await analyzeLiveMap(text, previous, provider, model, env));
});

app.post('/api/stt/:provider', async (c) => {
	const env = await getEnv(c.env);
	const provider = c.req.param('provider') as STTProvider;
	const valid: STTProvider[] = ['huggingface', 'deepgram', 'whisper', 'elevenlabs'];
	if (!valid.includes(provider)) return c.json({ error: 'Invalid STT provider' }, 400);
	const language = c.req.query('language') ?? 'auto';
	if (!isSpeechLanguage(language)) return c.json({ error: 'Invalid speech language' }, 400);
	const languageError = speechLanguageError(provider, language);
	if (languageError) return c.json({ error: languageError }, 400);
	const audio = await c.req.blob();
	if (!audio || audio.size === 0) return c.json({ error: 'Missing audio' }, 400);
	return c.json(await transcribeAudio(provider, audio, env, language));
});

app.post('/api/chat', async (c) => {
	const env = await getEnv(c.env);
	const body = (await c.req.json()) as Record<string, unknown>;
	const messages = (body.messages as ChatMessage[]) ?? [];
	const provider: AIProvider = (body.provider as AIProvider) ?? 'workers-ai';
	const model = (body.model as string) ?? (provider === 'workers-ai' ? env.WORKERS_AI_MODEL : provider === 'llmapi' ? env.LLMAPI_MODEL : env.OPENROUTER_MODEL);
	const meetingId = body.meeting_id as string | undefined;
	const docQuery = body.doc_query as string | undefined;

	const systemParts = [
		'You are a helpful assistant for the Roundtable meeting analysis app. Answer based on the provided transcript and/or policy document context.'
	];

	if (meetingId) {
		const meeting = await getMeeting(env.DB, meetingId);
		if (meeting) {
			const [transcript, chunks] = await Promise.all([
				readMeetingTranscript(env.DB, env.TRANSCRIPTS, meeting),
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

const referenceRequestSchema = z.object({
	nodes: z.array(z.object({ id: z.string().min(1).max(200), title: z.string().max(300), summary: z.string().max(3000) })).min(1).max(20),
	retry: z.boolean().default(false)
});

app.post('/api/meetings/:id/references', bodyLimit({ maxSize: 128 * 1024 }), async (c) => {
	const parsed = referenceRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'Invalid document reference request' }, 400);
	const env = await getEnv(c.env);
	const id = c.req.param('id');
	if (!env.DOCUMENT_QUEUE) return c.json({ error: 'Document queue is not configured.' }, 503);
	if (!await getMeeting(env.DB, id)) return c.json({ error: 'Meeting not found' }, 404);
	const references = await ensureDocumentJobs(env, id, parsed.data.nodes, parsed.data.retry);
	return c.json({ references }, 202);
});

app.get('/api/meetings/:id/references', async (c) => {
	const fingerprints = (c.req.query('fingerprints') ?? '').split(',');
	if (fingerprints.length > 20 || fingerprints.some((id) => !/^[a-f0-9]{64}$/.test(id))) return c.json({ error: 'Invalid reference fingerprints' }, 400);
	const env = await getEnv(c.env);
	const id = c.req.param('id');
	if (!await getMeeting(env.DB, id)) return c.json({ error: 'Meeting not found' }, 404);
	c.header('Cache-Control', 'no-store');
	return c.json({ references: await getDocumentReferences(env.DB, id, fingerprints) });
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

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<ReferenceMessage>, rawEnv: Env) {
		await consumeDocumentJobs(batch, await getEnv(rawEnv));
	},
	async scheduled(_controller: ScheduledController, rawEnv: Env) {
		await dispatchDocumentJobs(await getEnv(rawEnv));
	}
};
