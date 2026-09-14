import type { AppEnv } from './env';
import type { AIProvider, ChatMessage, MeetingMap, MeetingNode } from './types';

const SYSTEM_PROMPT = `You are a meeting analyst. Given a meeting transcript (or chunk), extract key discussion topics, decisions, action items, concerns, and context flow.

Return a JSON object with the following schema:
{
  "title": "Short meeting title (or chunk title)",
  "summary": "1-2 paragraph summary",
  "nodes": [
    { "id": "unique-id", "title": "Topic title", "summary": "Brief summary", "children": [ ... ] }
  ]
}

Rules:
- Each node must have a unique, kebab-case id and a 1 sentence summary.
- If the chunk is a continuation, focus on new topics and link them thematically.
- Do not wrap the JSON in markdown code fences.
- Respond ONLY with valid JSON.`;

function textToMessages(transcriptChunk: string, contextSummary?: string): ChatMessage[] {
	const userContent = contextSummary
		? `Previous context summary: ${contextSummary}\n\nAnalyze this transcript chunk:\n${transcriptChunk}`
		: `Analyze this transcript chunk:\n${transcriptChunk}`;
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: userContent }
	];
}

export async function analyzeChunk(
	transcriptChunk: string,
	provider: AIProvider,
	model: string,
	env: AppEnv,
	contextSummary?: string
): Promise<{ title: string; summary: string; nodes: MeetingNode[] }> {
	const messages = textToMessages(transcriptChunk, contextSummary);
	const text = await chatCompletion(messages, provider, model, env, { temperature: 0.4 });
	return parseAnalysisJson(text);
}

export async function chatCompletion(
	messages: ChatMessage[],
	provider: AIProvider,
	model: string,
	env: AppEnv,
	opts: { temperature?: number; max_tokens?: number } = {}
): Promise<string> {
	switch (provider) {
		case 'workers-ai':
			return workersAICompletion(messages, model, env, opts);
		case 'openrouter':
			return openRouterCompletion(messages, model, env, opts);
		case 'llmapi':
			return llmApiCompletion(messages, model, env, opts);
		default:
			throw new Error(`Unsupported AI provider: ${provider}`);
	}
}

function extractJson(text: string): string {
	const codeBlock = text.match(/```json\s*([\s\S]*?)```/);
	if (codeBlock) return codeBlock[1].trim();
	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		return text.slice(firstBrace, lastBrace + 1);
	}
	return text;
}

export function parseAnalysisJson(text: string): { title: string; summary: string; nodes: MeetingNode[] } {
	const json = extractJson(text);
	const parsed = JSON.parse(json);
	if (!Array.isArray(parsed.nodes)) {
		throw new Error("AI response missing 'nodes' array");
	}
	return {
		title: parsed.title || 'Untitled',
		summary: parsed.summary || '',
		nodes: parsed.nodes as MeetingNode[]
	};
}

export function buildFinalMap(chunks: { summary: string; nodes: MeetingNode[] }[]): MeetingMap {
	const root: MeetingNode = {
		id: 'root',
		title: 'Meeting Overview',
		summary: chunks.map((c) => c.summary).join(' '),
		children: []
	};
	for (const chunk of chunks) {
		root.children = root.children?.concat(chunk.nodes) ?? chunk.nodes;
	}
	return { nodes: [root] };
}

async function workersAICompletion(
	messages: ChatMessage[],
	model: string,
	env: AppEnv,
	opts: { temperature?: number; max_tokens?: number }
): Promise<string> {
	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
		throw new Error('Missing CF_ACCOUNT_ID or CF_API_TOKEN for Workers AI');
	}
	const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			messages: messages.map((m) => ({ role: m.role, content: m.content })),
			temperature: opts.temperature ?? 0.7,
			max_tokens: opts.max_tokens ?? 2048
		})
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Workers AI error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as { result?: { response?: string }; success: boolean; errors?: unknown[] };
	if (!data.success) {
		throw new Error(`Workers AI error: ${JSON.stringify(data.errors)}`);
	}
	return data.result?.response ?? '';
}

async function openRouterCompletion(
	messages: ChatMessage[],
	model: string,
	env: AppEnv,
	opts: { temperature?: number; max_tokens?: number }
): Promise<string> {
	if (!env.OPENROUTER_API_KEY) throw new Error('Missing OPENROUTER_API_KEY');
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://roundtable.policyobservatory.org',
			'X-Title': 'Roundtable v2'
		},
		body: JSON.stringify({
			model,
			messages,
			temperature: opts.temperature ?? 0.7,
			max_tokens: opts.max_tokens ?? 2048
		})
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenRouter error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? '';
}

async function llmApiCompletion(
	messages: ChatMessage[],
	model: string,
	env: AppEnv,
	opts: { temperature?: number; max_tokens?: number }
): Promise<string> {
	if (!env.LLMAPI_URL) throw new Error('Missing LLMAPI_URL');
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (env.LLMAPI_KEY) headers.Authorization = `Bearer ${env.LLMAPI_KEY}`;
	const res = await fetch(env.LLMAPI_URL, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model,
			messages,
			temperature: opts.temperature ?? 0.7,
			max_tokens: opts.max_tokens ?? 2048
		})
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`LLMApi error ${res.status}: ${err}`);
	}
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? '';
}
