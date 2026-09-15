<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let { content }: { content: string } = $props();
	const html = $derived(renderMarkdown(content));
</script>

<div class="markdown prose prose-sm max-w-none break-words dark:prose-invert prose-headings:my-3 prose-headings:font-serif prose-headings:font-normal prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:overflow-x-auto prose-pre:p-3 prose-a:text-accent prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground prose-li:text-foreground">
	<!-- Raw HTML is escaped and unsafe link protocols are rejected by renderMarkdown. -->
	{@html html}
</div>

<style>
	.markdown { overflow-wrap: anywhere; }
	.markdown :global(> :first-child) { margin-top: 0; }
	.markdown :global(> :last-child) { margin-bottom: 0; }
	.markdown :global(table) { display: block; overflow-x: auto; }
	.markdown :global(th), .markdown :global(td) { min-width: 5rem; padding: 0.4rem; }
</style>
