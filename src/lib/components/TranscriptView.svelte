<script lang="ts">
	import type { TranscriptSegment } from '$shared/types';
	let { transcript, segments = [], baseTranscript = '' }: {
		transcript: string; segments?: TranscriptSegment[]; baseTranscript?: string;
	} = $props();
	let timestamped = $state(true);
	const ordered = $derived([...segments].sort((a, b) => a.segment_index - b.segment_index));
</script>

<div role="group" aria-label="Transcript view" class="mb-3 flex gap-1 text-xs">
	<button class="rounded px-2 py-1 {timestamped ? 'bg-accent-soft text-accent' : 'text-muted'}" aria-pressed={timestamped} onclick={() => timestamped = true}>Timestamps</button>
	<button class="rounded px-2 py-1 {!timestamped ? 'bg-accent-soft text-accent' : 'text-muted'}" aria-pressed={!timestamped} onclick={() => timestamped = false}>Plain text</button>
</div>
{#if timestamped && ordered.length}
	<p class="mb-4 text-[11px] text-muted">Times show when each segment was transcribed, in your local time—not exact audio or word timings.</p>
	{#if baseTranscript}<div class="mb-4"><p class="mb-1 text-[10px] text-muted">Imported notes · no segment timestamp</p><p class="whitespace-pre-wrap text-xs leading-relaxed text-muted">{baseTranscript}</p></div>{/if}
	<ol aria-label="Timestamped transcript" class="space-y-4">
		{#each ordered as segment (segment.id)}
			<li>
				<time datetime={segment.created_at} title={new Date(segment.created_at).toLocaleString()} class="text-[11px] font-medium tabular-nums text-accent">{new Date(segment.created_at).toLocaleTimeString()}</time>
				<p class="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">{segment.text}</p>
			</li>
		{/each}
	</ol>
{:else}
	{#if timestamped}<p class="mb-3 text-[11px] text-muted">No segment timestamps were saved for this transcript. Any timestamps in the original text are preserved below.</p>{/if}
	<p class="whitespace-pre-wrap text-xs leading-relaxed text-muted">{transcript}</p>
{/if}
