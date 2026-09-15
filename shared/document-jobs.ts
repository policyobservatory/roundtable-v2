import type { D1Database } from '@cloudflare/workers-types';
import type { AppEnv } from './env';
import { retryIdempotent } from './retry.ts';
import { searchDocuments, DocumentApiError } from './docs.ts';
import { referenceFingerprint, referenceQuery, referenceRevision, type DocumentReference, type ReferenceAssignment, type ReferenceMessage, type ReferenceStatus, type ReferenceTopic } from './document-references.ts';

export interface ReferenceEnv extends AppEnv { DB: D1Database; DOCUMENT_QUEUE: Queue<ReferenceMessage> }
interface JobRow {
	id: string; meeting_id: string; fingerprint: string; query: string; generation: number;
	status: ReferenceStatus; attempts: number; dispatch_after: number; lease_token: string | null;
	lease_until: number; documents: string; error: string | null; updated_at: string;
}
const MAX_ATTEMPTS = 4;
const LEASE_MS = 120000; // Search + bounded optional bill lookups fit inside this lease.
const serialize = (row: JobRow): DocumentReference => ({ id: row.id, fingerprint: row.fingerprint, generation: row.generation, status: row.status,
	documents: JSON.parse(row.documents), error: row.error ?? undefined, updated_at: row.updated_at });

export async function getDocumentReferences(db: D1Database, meetingId: string, fingerprints: string[]): Promise<DocumentReference[]> {
	if (!fingerprints.length) return [];
	const result = await retryIdempotent(() => db.prepare(`SELECT * FROM document_jobs WHERE meeting_id = ? AND fingerprint IN (${fingerprints.map(() => '?').join(',')})`)
		.bind(meetingId, ...fingerprints).all<JobRow>());
	return result.results.map(serialize);
}

/** Commit the outbox before sending. A crash/send failure is recovered by the scheduled sweep. */
export async function ensureDocumentJobs(env: ReferenceEnv, meetingId: string, topics: ReferenceTopic[], retryErrors = false): Promise<ReferenceAssignment[]> {
	if (!env.DOCUMENT_QUEUE) throw new Error('Document queue is not configured.');
	const assignments: ReferenceAssignment[] = [];
	for (let start = 0; start < topics.length; start += 20) {
		const topicsWithHashes = await Promise.all(topics.slice(start, start + 20).map(async (topic) => ({ topic, fingerprint: await referenceFingerprint(topic) })));
		const now = new Date().toISOString();
		const statements = topicsWithHashes.map(({ topic, fingerprint }) => env.DB.prepare(`INSERT INTO document_jobs
			(id, meeting_id, fingerprint, query, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
			.bind(`${meetingId}:${fingerprint}`, meetingId, fingerprint, referenceQuery(topic), now, now));
		if (retryErrors) for (const { fingerprint } of topicsWithHashes) {
			statements.push(env.DB.prepare(`UPDATE document_jobs SET status = 'pending', generation = generation + 1, attempts = 0,
				dispatch_after = 0, lease_token = NULL, lease_until = 0, error = NULL, updated_at = ? WHERE id = ? AND status = 'error'`)
				.bind(now, `${meetingId}:${fingerprint}`));
		}
		if (statements.length) await retryIdempotent(() => env.DB.batch(statements));
		// The queue send is independent of transcript saves. Do not turn accepted outbox work into a false failure.
		try { await dispatchDocumentJobs(env, topicsWithHashes.map(({ fingerprint }) => `${meetingId}:${fingerprint}`)); }
		catch { console.warn(JSON.stringify({ event: 'document_dispatch_deferred', meetingId })); }
		const references = await getDocumentReferences(env.DB, meetingId, topicsWithHashes.map(({ fingerprint }) => fingerprint));
		for (const { topic, fingerprint } of topicsWithHashes) {
			const reference = references.find((ref) => ref.fingerprint === fingerprint);
			if (reference) assignments.push({ revision: referenceRevision(topic), reference });
		}
	}
	return assignments;
}

/** Atomic dispatch lease limits duplicate publishes from simultaneous POSTs/Cron invocations. */
export async function dispatchDocumentJobs(env: ReferenceEnv, ids?: string[], now = Date.now()) {
	if (!env.DOCUMENT_QUEUE) throw new Error('Document queue is not configured.');
	await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET status = 'error', error = 'Document search exhausted its retries. Try again.', updated_at = ?
		WHERE status IN ('pending','queued','searching') AND attempts >= ? AND lease_until <= ? AND dispatch_after <= ?`)
		.bind(new Date(now).toISOString(), MAX_ATTEMPTS, now, now).run());
	if (ids && !ids.length) return;
	const filter = ids ? `AND id IN (${ids.map(() => '?').join(',')})` : '';
	const result = await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET dispatch_after = ? WHERE id IN (
		SELECT id FROM document_jobs WHERE status IN ('pending','queued','searching') AND dispatch_after <= ?
		AND lease_until <= ? AND attempts < ? ${filter} ORDER BY dispatch_after, created_at LIMIT 20
	) RETURNING *`).bind(now + 60000, now, now, MAX_ATTEMPTS, ...(ids ?? [])).all<JobRow>());
	for (const job of result.results) {
		try {
			await env.DOCUMENT_QUEUE.send({ jobId: job.id, generation: job.generation }, { contentType: 'json' });
			await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET status = CASE WHEN status = 'pending' THEN 'queued' ELSE status END,
				dispatch_after = ?, updated_at = ? WHERE id = ? AND generation = ? AND status IN ('pending','queued')`)
				.bind(now + 600000, new Date(now).toISOString(), job.id, job.generation).run());
		} catch { console.warn(JSON.stringify({ event: 'document_queue_send_failed', jobId: job.id })); }
	}
}

async function processDocumentMessage(message: Message<ReferenceMessage>, env: ReferenceEnv) {
	const body = message.body;
	if (!body || typeof body.jobId !== 'string' || !Number.isInteger(body.generation) || body.generation < 0) {
		console.warn(JSON.stringify({ event: 'invalid_document_message' })); message.ack(); return;
	}
	const token = crypto.randomUUID();
	const now = Date.now();
	let job = await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET status = 'searching', attempts = attempts + 1,
		lease_token = ?, lease_until = ?, dispatch_after = ?, updated_at = ?
		WHERE id = ? AND generation = ? AND status IN ('pending','queued','searching') AND lease_until <= ? AND attempts < ?
		RETURNING *`).bind(token, now + LEASE_MS, now + LEASE_MS, new Date(now).toISOString(), body.jobId, body.generation, now, MAX_ATTEMPTS).first<JobRow>());
	// A lost D1 acknowledgement may have committed the claim before retrying it.
	if (!job) job = await retryIdempotent(() => env.DB.prepare('SELECT * FROM document_jobs WHERE id = ? AND lease_token = ?').bind(body.jobId, token).first<JobRow>());
	if (!job) { message.ack(); return; } // completed, stale generation, deleted, or another consumer owns the lease
	try {
		console.info(JSON.stringify({ event: 'document_search_started', jobId: job.id, attempt: job.attempts }));
		const documents = await searchDocuments(job.query, env);
		await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET status = ?, documents = ?, error = NULL,
			lease_token = NULL, lease_until = 0, updated_at = ? WHERE id = ? AND generation = ? AND lease_token = ?`)
			.bind(documents.length ? 'ready' : 'empty', JSON.stringify(documents), new Date().toISOString(), job!.id, job!.generation, token).run());
		console.info(JSON.stringify({ event: 'document_search_finished', jobId: job.id, matches: documents.length }));
		message.ack();
	} catch (error) {
		const terminal = (error instanceof DocumentApiError && !error.retryable) || job.attempts >= MAX_ATTEMPTS;
		const delaySeconds = Math.min(300, 15 * 2 ** (job.attempts - 1));
		const detail = error instanceof DocumentApiError ? error.message : 'Document search was interrupted. It will be retried.';
		await retryIdempotent(() => env.DB.prepare(`UPDATE document_jobs SET status = ?, error = ?, lease_token = NULL,
			lease_until = 0, dispatch_after = ?, updated_at = ? WHERE id = ? AND generation = ? AND lease_token = ?`)
			.bind(terminal ? 'error' : 'pending', detail, Date.now() + delaySeconds * 1000, new Date().toISOString(), job!.id, job!.generation, token).run());
		console.warn(JSON.stringify({ event: 'document_search_failed', jobId: job.id, attempt: job.attempts, terminal, detail }));
		if (terminal) message.ack(); else message.retry({ delaySeconds });
	}
}

export async function consumeDocumentJobs(batch: MessageBatch<ReferenceMessage>, env: ReferenceEnv) {
	// Production batches contain one message; explicit per-message outcomes also support tests/larger batches.
	for (const message of batch.messages) {
		try { await processDocumentMessage(message, env); }
		catch { console.error(JSON.stringify({ event: 'document_job_storage_failure' })); message.retry({ delaySeconds: 30 }); }
	}
}
