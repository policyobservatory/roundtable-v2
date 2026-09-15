<script lang="ts">
	import { BookOpen, ExternalLink } from '@lucide/svelte';
	import { linkedDocuments, safeDocumentUrl, type DocumentReference } from '$shared/document-references';
	let { reference, compact = false }: { reference?: DocumentReference; compact?: boolean } = $props();
	const documents = $derived(linkedDocuments(reference));
</script>

{#if documents.length}
<section class={compact ? 'text-[11px]' : 'mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700'} aria-label="Related policy documents">
	<h4 class="flex items-center gap-2 font-semibold"><BookOpen class="h-3 w-3 shrink-0" /> Related documents</h4>
	{#if compact}
		<ul class="mt-2 space-y-1.5">
			{#each documents as document, index (`${document.id}-${index}`)}
				<li><a class="block truncate text-blue-600 underline dark:text-blue-400" title={document.title} href={safeDocumentUrl(document.source_url) ?? safeDocumentUrl(document.url) ?? safeDocumentUrl(document.bill_url)} target="_blank" rel="noopener noreferrer">{document.title}</a></li>
			{/each}
		</ul>
	{:else}
		<ul class="mt-3 space-y-4">
			{#each documents as document, index (`${document.id}-${index}`)}
				<li class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
					<h5 class="break-words text-xs font-semibold">{document.title}</h5>
					{#if document.bill_title}<p class="mt-1 text-xs text-zinc-500">{document.bill_title}</p>{/if}
					{#if document.bill_status}<p class="mt-2 text-[11px] text-zinc-500">Status: {document.bill_status}</p>{/if}
					<details class="mt-2 text-xs"><summary class="cursor-pointer text-blue-600 dark:text-blue-400">View provision excerpt</summary><p class="mt-2 whitespace-pre-wrap break-words leading-relaxed">{document.content}</p></details>
					<div class="mt-3 flex flex-wrap gap-3 text-xs text-blue-600 dark:text-blue-400">
						{#if safeDocumentUrl(document.source_url)}<a class="inline-flex items-center gap-1 underline" href={safeDocumentUrl(document.source_url)} target="_blank" rel="noopener noreferrer">Original document <ExternalLink class="h-3 w-3" /></a>{/if}
						{#if safeDocumentUrl(document.url)}<a class="underline" href={safeDocumentUrl(document.url)} target="_blank" rel="noopener noreferrer">Provision record</a>{/if}
						{#if safeDocumentUrl(document.bill_url)}<a class="underline" href={safeDocumentUrl(document.bill_url)} target="_blank" rel="noopener noreferrer">Bill metadata</a>{/if}
					</div>
				</li>
			{/each}
		</ul>
		<p class="mt-3 text-[10px] leading-relaxed text-zinc-500">Retrieved from Policy Observatory. These are candidate matches, not verified legal advice. Proposed bills are not necessarily enacted law. Excerpts may be truncated.</p>
	{/if}
	{#if reference && !compact}<p class="mt-2 text-[10px] text-zinc-500">Updated {new Date(reference.updated_at).toLocaleString()}</p>{/if}
</section>
{/if}
