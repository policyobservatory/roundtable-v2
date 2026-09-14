import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_MODELS, DEFAULT_AI_MODEL, getAIModel } from '../src/lib/constants.ts';

test('the first configured model is the default', () => {
	assert.ok(AI_MODELS.length > 0);
	assert.equal(DEFAULT_AI_MODEL, AI_MODELS[0]);
	assert.equal(DEFAULT_AI_MODEL.provider, 'workers-ai');
	assert.equal(DEFAULT_AI_MODEL.model, '@cf/zai-org/glm-5.3-flash');
	assert.ok(AI_MODELS.some((option) => option.id === 'openrouter-gpt-4o-mini'));
});

test('dropdown entries have unique IDs and complete provider configuration', () => {
	assert.equal(new Set(AI_MODELS.map((option) => option.id)).size, AI_MODELS.length);
	for (const option of AI_MODELS) {
		for (const field of ['id', 'label', 'model', 'description']) {
			assert.ok(option[field].trim(), `${option.id}: ${field} must not be empty`);
		}
		assert.ok(['openrouter', 'workers-ai', 'llmapi'].includes(option.provider));
		assert.equal(getAIModel(option.id), option);
	}
});

test('unknown or removed IDs fall back to an offered model', () => {
	assert.equal(getAIModel('removed-model'), DEFAULT_AI_MODEL);
	assert.equal(getAIModel(''), DEFAULT_AI_MODEL);
});
