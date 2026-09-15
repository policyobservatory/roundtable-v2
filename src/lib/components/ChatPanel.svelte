<script lang="ts">
	import { Send, Loader2, Plus, Trash2, RefreshCw } from '@lucide/svelte';
	import { onMount, onDestroy, tick } from 'svelte';
	import { listChatSessions, createChatSession, getChatSession, deleteChatSession, sendChatTurn } from '$lib/api';
	import type { AIProvider } from '$shared/types';
	import type { ChatSession, ChatSessionData, ChatTurn, SavedChatMessage, SendChatTurn } from '$shared/chat-types';
	import { AI_MODELS, DEFAULT_AI_MODEL, getAIModel } from '$lib/constants';
	import ModelSelect from './ModelSelect.svelte';
	import Markdown from './Markdown.svelte';
	import Button from './ui/Button.svelte';
	import Card from './ui/Card.svelte';
	import Textarea from './ui/Textarea.svelte';

	let { meetingId, provider = DEFAULT_AI_MODEL.provider, model = DEFAULT_AI_MODEL.model }: { meetingId: string; provider?: AIProvider; model?: string } = $props();
	let sessions = $state<ChatSession[]>([]);
	let hasMoreSessions = $state(false);
	let selectedId = $state<string | null>(null);
	let messages = $state<SavedChatMessage[]>([]);
	let latestTurn = $state<ChatTurn | null>(null);
	let before = $state<number | null>(null);
	let input = $state('');
	let error = $state('');
	let ready = $state(false);
	let loading = $state(true);
	let sending = $state(false);
	let loadingOlder = $state(false);
	let pendingRequest = $state<SendChatTurn | null>(null);
	let selectedModelId = $state<string | null>(null);
	let panel = $state<HTMLDivElement>();
	let disposed = false;
	let version = 0;
	let refreshing = false;
	let creationId: string | null = null;
	const reads = new AbortController();
	const selectedModel = $derived(selectedModelId === null
		? AI_MODELS.find(option => option.provider === provider && option.model === model) ?? DEFAULT_AI_MODEL
		: getAIModel(selectedModelId));
	const pending = $derived(latestTurn?.status === 'pending');
	const busy = $derived(loading || sending || pending);
	const unsavedRequest = $derived(pendingRequest && !messages.some(m => m.turn_id === pendingRequest?.id) ? pendingRequest : null);
	const retryRequest = $derived(pendingRequest ?? (latestTurn?.status === 'error' ? { id: latestTurn.id, content: latestTurn.content, provider: latestTurn.provider, model: latestTurn.model } : null));

	onMount(() => { void initialize(); });
	onDestroy(() => { disposed = true; version++; reads.abort(); });
	$effect(() => {
		const id = selectedId;
		if (!id || !pending || sending) return;
		const interval = setInterval(() => { void refreshCurrent(id); }, 3000);
		return () => clearInterval(interval);
	});

	function remember(id: string | null) {
		try { if (id) localStorage.setItem(`roundtable-chat:${meetingId}`, id); else localStorage.removeItem(`roundtable-chat:${meetingId}`); } catch { /* D1 persistence does not require browser storage. */ }
	}
	function mergeMessages(a: SavedChatMessage[], b: SavedChatMessage[]) {
		return [...new Map([...a, ...b].map(m => [m.id, m])).values()].sort((a, b) => a.position - b.position);
	}
	function apply(data: ChatSessionData, replace = false) {
		messages = replace ? data.messages : mergeMessages(messages, data.messages);
		if (replace) before = data.before;
		latestTurn = data.latestTurn;
		sessions = [data.session, ...sessions.filter(s => s.id !== data.session.id)];
		if (data.latestTurn?.id === pendingRequest?.id && data.latestTurn?.status === 'complete') pendingRequest = null;
	}
	async function scrollBottom() { await tick(); if (!disposed && panel) panel.scrollTop = panel.scrollHeight; }
	async function openSession(id: string) {
		const current = ++version;
		selectedId = id; loading = true; error = ''; messages = []; latestTurn = null; before = null; pendingRequest = null; input = '';
		remember(id);
		try {
			const data = await getChatSession(meetingId, id, undefined, reads.signal);
			if (disposed || current !== version) return;
			apply(data, true);
			selectedModelId = AI_MODELS.find(m => m.provider === data.session.provider && m.model === data.session.model)?.id ?? DEFAULT_AI_MODEL.id;
			await scrollBottom();
			return true;
		} catch (err) { if (!disposed && current === version) error = err instanceof Error ? err.message : String(err); return false; }
		finally { if (!disposed && current === version) loading = false; }
	}
	async function initialize() {
		loading = true; error = '';
		try {
			const result = await listChatSessions(meetingId, 0, reads.signal);
			if (disposed) return;
			sessions = result.sessions; hasMoreSessions = result.hasMore; ready = true;
			let saved: string | null = null;
			try { saved = localStorage.getItem(`roundtable-chat:${meetingId}`); } catch { /* Optional. */ }
			const id = saved ?? sessions[0]?.id;
			if (id) {
				const opened = await openSession(id);
				if (!opened && !disposed && saved && saved !== sessions[0]?.id) {
					remember(null);
					if (sessions[0]) await openSession(sessions[0].id);
					else { selectedId = null; messages = []; latestTurn = null; before = null; }
				}
			}
			else { selectedId = null; messages = []; latestTurn = null; before = null; remember(null); }
		} catch (err) { if (!disposed) { ready = false; error = err instanceof Error ? err.message : String(err); } }
		finally { if (!disposed) loading = false; }
	}
	async function moreSessions() {
		loading = true;
		try {
			const result = await listChatSessions(meetingId, sessions.length, reads.signal);
			if (!disposed) { sessions = [...new Map([...sessions, ...result.sessions].map(s => [s.id, s])).values()]; hasMoreSessions = result.hasMore; }
		} catch (err) { if (!disposed) error = err instanceof Error ? err.message : String(err); }
		finally { if (!disposed) loading = false; }
	}
	async function newSession() {
		creationId ??= crypto.randomUUID();
		const session = await createChatSession(meetingId, { id: creationId, provider: selectedModel.provider, model: selectedModel.model });
		creationId = null;
		if (!disposed) {
			version++; selectedId = session.id; sessions = [session, ...sessions.filter(s => s.id !== session.id)];
			messages = []; latestTurn = null; before = null; remember(session.id);
		}
		return session.id;
	}
	async function createNew() {
		if (busy || !ready) return;
		loading = true; error = '';
		try { await newSession(); if (!disposed) { input = ''; pendingRequest = null; } }
		catch (err) { if (!disposed) error = err instanceof Error ? err.message : String(err); }
		finally { if (!disposed) loading = false; }
	}
	async function removeSession() {
		const id = selectedId;
		if (!id || busy || !confirm('Delete this chat and its messages? The meeting transcript will be kept.')) return;
		loading = true; error = '';
		try {
			await deleteChatSession(meetingId, id);
			if (disposed) return;
			selectedId = null; pendingRequest = null; input = ''; remember(null);
			await initialize();
		} catch (err) { if (!disposed) error = err instanceof Error ? err.message : String(err); }
		finally { if (!disposed) loading = false; }
	}
	async function refreshCurrent(id = selectedId) {
		if (!id) { await initialize(); return; }
		if (refreshing) return;
		refreshing = true;
		const current = version;
		try {
			const data = await getChatSession(meetingId, id, undefined, reads.signal);
			if (disposed || current !== version || id !== selectedId) return;
			apply(data); error = '';
		} catch (err) { if (!disposed && current === version) error = err instanceof Error ? err.message : String(err); }
		finally { refreshing = false; }
	}
	async function loadOlder() {
		if (!selectedId || !before || loadingOlder) return;
		const current = version;
		loadingOlder = true;
		const oldHeight = panel?.scrollHeight ?? 0;
		const oldTop = panel?.scrollTop ?? 0;
		try {
			const data = await getChatSession(meetingId, selectedId, before, reads.signal);
			if (disposed || current !== version) return;
			messages = mergeMessages(data.messages, messages); before = data.before;
			await tick(); if (panel) panel.scrollTop = oldTop + panel.scrollHeight - oldHeight;
		} catch (err) { if (!disposed && current === version) error = err instanceof Error ? err.message : String(err); }
		finally { if (!disposed) loadingOlder = false; }
	}
	async function submit(request?: SendChatTurn) {
		if (busy || !ready || (!request && (!input.trim() || input.trim().length > 4000))) return;
		const turn = request ?? { id: crypto.randomUUID(), content: input.trim(), provider: selectedModel.provider, model: selectedModel.model };
		version++; // Ignore any snapshot requested before this send began.
		pendingRequest = turn; sending = true; error = '';
		if (!request) input = '';
		let id = selectedId;
		try {
			id ??= await newSession();
			if (disposed) return;
			await scrollBottom();
			const data = await sendChatTurn(meetingId, id, turn);
			if (disposed || id !== selectedId) return;
			apply(data); pendingRequest = null;
			await scrollBottom();
		} catch (err) {
			if (disposed) return;
			if (id) await refreshCurrent(id);
			if (!disposed) error = err instanceof Error ? err.message : String(err);
		} finally { if (!disposed) sending = false; }
	}
</script>

<Card class="flex min-h-0 w-96 max-w-full shrink-0 flex-col rounded-none border-l border-border">
	<div class="space-y-3 border-b border-border p-4">
		<div class="flex items-center justify-between gap-2">
			<h3 class="font-serif text-xl font-normal">Chat with meeting</h3>
			<div class="flex gap-1">
				<Button variant="ghost" size="icon" title="New chat" disabled={busy || !ready} onclick={createNew}><Plus class="h-4 w-4" /><span class="sr-only">New chat</span></Button>
				<Button variant="ghost" size="icon" title="Refresh chat" disabled={loading || sending} onclick={() => { void (error || !ready ? initialize() : refreshCurrent()); }}><RefreshCw class="h-4 w-4" /><span class="sr-only">Refresh chat</span></Button>
				<Button variant="ghost" size="icon" title="Delete chat" disabled={busy || !selectedId} onclick={removeSession}><Trash2 class="h-4 w-4" /><span class="sr-only">Delete chat</span></Button>
			</div>
		</div>
		<label class="block text-xs text-muted" for="chat-session">Saved chats</label>
		<select id="chat-session" value={selectedId ?? ''} disabled={loading || sending || !sessions.length} onchange={e => { void openSession(e.currentTarget.value); }} class="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
			{#if !sessions.length}<option value="">New conversation</option>{/if}
			{#each sessions as session (session.id)}<option value={session.id}>{session.title}</option>{/each}
		</select>
		{#if hasMoreSessions}<button class="text-xs text-accent" disabled={busy} onclick={moreSessions}>Load more chats</button>{/if}
		<ModelSelect id="chat-ai-model" value={selectedModel.id} onchange={id => selectedModelId = id} disabled={busy} />
	</div>
	<div bind:this={panel} class="flex-1 space-y-3 overflow-auto p-4">
		{#if before}<button class="text-xs text-accent" disabled={loadingOlder} onclick={loadOlder}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>{/if}
		{#if loading}<p class="text-xs text-muted">Loading chats…</p>{:else if !messages.length && !pendingRequest}<p class="text-xs text-muted">Ask about this meeting. Each chat has its own saved history.</p>{/if}
		{#each messages as msg (msg.id)}
			<div data-message-role={msg.role} class="mr-6 text-left">
				<div class={`inline-block max-w-full rounded px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-foreground'}`}>
					{#if msg.role === 'assistant'}<Markdown content={msg.content} />{:else}<span class="whitespace-pre-wrap break-words">{msg.content}</span>{/if}
				</div>
			</div>
		{/each}
		{#if unsavedRequest}<div data-message-role="user" class="mr-6 text-left"><div class="inline-block max-w-full whitespace-pre-wrap break-words rounded bg-primary px-3 py-2 text-sm text-primary-foreground">{unsavedRequest.content}</div><p class="mt-1 text-[10px] text-muted">{sending ? 'Sending…' : 'Delivery not confirmed'}</p></div>{/if}
		{#if sending || pending}<div class="flex items-center gap-2 text-sm text-muted"><Loader2 class="h-4 w-4 animate-spin" /> Thinking…</div>{/if}
		{#if error}<p role="alert" class="text-xs text-red-600 dark:text-red-400">{error}</p>{/if}
		{#if latestTurn?.status === 'error'}<p class="text-xs text-muted">{latestTurn.error}</p>{/if}
		{#if retryRequest && !busy}<button class="text-xs text-accent underline" onclick={() => { if (retryRequest) void submit(retryRequest); }}>Retry message</button>{/if}
	</div>
	<form onsubmit={e => { e.preventDefault(); void submit(); }} class="border-t border-border p-3">
		<div class="flex gap-2">
			<Textarea bind:value={input} placeholder="Ask something..." rows={1} class="min-h-0 flex-1 resize-none" onkeydown={event => {
				if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!event.repeat) void submit(); }
			}} />
			<Button type="submit" disabled={busy || !ready || !input.trim() || input.trim().length > 4000} size="icon" class="shrink-0" title="Send message"><Send class="h-4 w-4" /><span class="sr-only">Send message</span></Button>
		</div>
		{#if input.length > 4000}<p class="mt-2 text-xs text-red-600 dark:text-red-400">Messages can contain up to 4,000 characters.</p>{/if}
	</form>
</Card>
