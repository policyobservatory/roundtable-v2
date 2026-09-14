import { z } from 'zod';

const segmentSchema = z.object({
	id: z.string().uuid(), meeting_id: z.string().uuid(), segment_index: z.number().int().min(0),
	text: z.string(), created_at: z.string().datetime(), saved: z.boolean()
});
const draftSchema = z.object({
	meetingId: z.string().uuid(), modelId: z.string(), segments: z.array(segmentSchema)
});
export type LiveSegment = z.infer<typeof segmentSchema>;
export type LiveDraft = z.infer<typeof draftSchema>;
const KEY = 'roundtable-live-draft-v1';

export function readLiveDraft(storage: Pick<Storage, 'getItem'>): LiveDraft | null {
	try {
		const result = draftSchema.safeParse(JSON.parse(storage.getItem(KEY) ?? 'null'));
		return result.success ? result.data : null;
	} catch { return null; }
}
export function saveLiveDraft(storage: Pick<Storage, 'setItem'>, draft: LiveDraft): boolean {
	try { storage.setItem(KEY, JSON.stringify(draft)); return true; }
	catch { return false; }
}
export function clearLiveDraft(storage: Pick<Storage, 'removeItem'>) {
	storage.removeItem(KEY);
}

/** Keep recognized text visible even when persistence fails. Never discard it on a failed save. */
export async function persistLiveSegment(segment: LiveSegment, save: (segment: LiveSegment) => Promise<unknown>): Promise<void> {
	await save(segment);
	segment.saved = true;
}
