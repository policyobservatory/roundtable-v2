<script lang="ts">
	import type { TranscriptSegment } from '$shared/types';
	let { transcript, segments = [], baseTranscript = '' }: {
		transcript: string; segments?: TranscriptSegment[]; baseTranscript?: string;
	} = $props();
	let timestamped = $state(true);
	const ordered = $derived([...segments].sort((a, b) => a.segment_index - b.segment_index));
</script>

<div role="group" aria-label="Transcript view" class="mb-3 flex gap-1 text-xs">
	<button class="rounded px-2 py-1 {timestamped ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'text-zinc-500'}" aria-pressed={timestamped} onclick={() => timestamped = true}>Timestamps</button>
	<button class="rounded px-2 py-1 {!timestamped ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'text-zinc-500'}" aria-pressed={!timestamped} onclick={() => timestamped = false}>Plain text</button>
</div>
{#if timestamped && ordered.length}
	<p class="mb-4 text-[11px] text-zinc-500">Times show when each segment was transcribed, in your local time—not exact audio or word timings.</p>
	{#if baseTranscript}<div class="mb-4"><p class="mb-1 text-[10px] text-zinc-500">Imported notes · no segment timestamp</p><p class="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{baseTranscript}</p></div>{/if}
	<ol aria-label="Timestamped transcript" class="space-y-4">
		{#each ordered as segment (segment.id)}
			<li>
				<time datetime={segment.created_at} title={new Date(segment.created_at).toLocaleString()} class="text-[11px] font-medium tabular-nums text-blue-600 dark:text-blue-400">{new Date(segment.created_at).toLocaleTimeString()}</time>
				<p class="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{segment.text}</p>
			</li>
		{/each}
	</ol>
{:else}
	{#if timestamped}<p class="mb-3 text-[11px] text-zinc-500">No segment timestamps were saved for this transcript. Any timestamps in the original text are preserved below.</p>{/if}
	<p class="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{transcript}</p>
{/if}
