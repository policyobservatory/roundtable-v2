import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeChunk, chatCompletion } from '../shared/ai.ts';
import { parseEnv } from '../shared/env.ts';
import { DEFAULT_WORKERS_AI_MODEL } from '../shared/ai-defaults.ts';

const messages = [{ role: 'user', content: 'Summarize the meeting.' }];

test('the Workers AI server default is Cloudflare GLM-5.3 Flash', () => {
	assert.equal(parseEnv({}).WORKERS_AI_MODEL, '@cf/zai-org/glm-5.3-flash');
});

test('GLM transcript analysis uses the AI binding and parses final completion content without API credentials', async () => {
	const graph = { title: 'Planning', summary: 'The budget was approved.', nodes: [{ id: 'budget', title: 'Budget', summary: 'Approved.', decisions: ['Approved'], actions: [], concerns: [] }], edges: [] };
	const env = parseEnv({ AI: { async run(model, input) {
		assert.equal(model, DEFAULT_WORKERS_AI_MODEL);
		assert.equal(input.stream, false);
		assert.equal(input.max_tokens, 4096);
		assert.ok(input.messages.some((message) => message.content.includes('Approve the budget')));
		return { choices: [{ message: { content: JSON.stringify(graph), reasoning_content: 'Must not be used as final text.' }, finish_reason: 'stop' }] };
	} } });
	assert.deepEqual(await analyzeChunk('Approve the budget', 'workers-ai', DEFAULT_WORKERS_AI_MODEL, env), graph);
});

test('the existing Llama choice also works through the binding with its legacy response shape', async () => {
	const env = parseEnv({ AI: { async run(model) {
		assert.equal(model, '@cf/meta/llama-3.1-8b-instruct');
		return { response: 'Meeting summary.' };
	} } });
	assert.equal(await chatCompletion(messages, 'workers-ai', '@cf/meta/llama-3.1-8b-instruct', env), 'Meeting summary.');
});

for (const [response, error] of [
	[{ choices: [{ message: { content: null, reasoning_content: 'Not a completed answer' }, finish_reason: 'stop' }] }, /no final text/],
	[{ choices: [{ message: { content: '{"partial":' }, finish_reason: 'length' }] }, /truncated/],
	[{ response: '' }, /no final text/]
]) {
	test(`invalid or incomplete Workers AI output fails clearly: ${error}`, async () => {
		const env = parseEnv({ AI: { async run() { return response; } } });
		await assert.rejects(chatCompletion(messages, 'workers-ai', DEFAULT_WORKERS_AI_MODEL, env), error);
	});
}

test('binding errors propagate rather than silently switching to another model/provider', async () => {
	const env = parseEnv({ AI: { async run() { throw new Error('Paid access required'); } } });
	await assert.rejects(chatCompletion(messages, 'workers-ai', DEFAULT_WORKERS_AI_MODEL, env), /Paid access required/);
});

test('legacy REST fallback handles GLM completions and Llama text responses', async () => {
	const originalFetch = globalThis.fetch;
	const env = parseEnv({ CF_ACCOUNT_ID: 'test-account', CF_API_TOKEN: 'test-token' });
	try {
		for (const [model, result] of [[DEFAULT_WORKERS_AI_MODEL, { choices: [{ message: { content: 'GLM summary' }, finish_reason: 'stop' }] }], ['@cf/meta/llama-3.1-8b-instruct', { response: 'Llama summary' }]]) {
			globalThis.fetch = async (url, options) => {
				assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/${model}`);
				assert.equal(options.headers.Authorization, 'Bearer test-token');
				return Response.json({ success: true, result });
			};
			assert.match(await chatCompletion(messages, 'workers-ai', model, env), /summary/);
		}
	} finally { globalThis.fetch = originalFetch; }
});
