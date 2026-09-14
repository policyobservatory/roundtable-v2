import type { R2Bucket } from '@cloudflare/workers-types';

export async function putTranscript(bucket: R2Bucket, key: string, text: string): Promise<void> {
	await bucket.put(key, text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
}

export async function getTranscript(bucket: R2Bucket, key: string): Promise<string | null> {
	const object = await bucket.get(key);
	if (!object) return null;
	return object.text();
}

export async function appendTranscript(bucket: R2Bucket, key: string, text: string): Promise<void> {
	const existing = await getTranscript(bucket, key);
	const next = existing ? existing + '\n' + text : text;
	await putTranscript(bucket, key, next);
}

export async function deleteTranscript(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key);
}

export async function putAudio(bucket: R2Bucket, key: string, blob: Blob): Promise<void> {
	await bucket.put(key, await blob.arrayBuffer(), { httpMetadata: { contentType: blob.type || 'audio/webm' } });
}
