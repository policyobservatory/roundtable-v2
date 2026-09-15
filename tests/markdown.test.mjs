import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/lib/markdown.ts';

test('meeting replies render headings, emphasis, lists, links, code and tables', () => {
	const html = renderMarkdown('# Summary\n\n**Decision** and *context* with `code`.\n\n- First\n- Second\n\n1. Follow up\n\n[Policy](https://example.org)\n\n```js\nconst a = 1;\n```\n\n| Topic | Owner |\n| --- | --- |\n| Budget | Alex |');
	for (const tag of ['h1', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'pre', 'table', 'th', 'td']) {
		assert.match(html, new RegExp(`<${tag}[ >]`));
	}
	assert.match(html, /href="https:\/\/example.org"/);
});

test('untrusted model output cannot inject HTML or unsafe link protocols', () => {
	const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n[encoded](jav&#x61;script:alert%281%29)\n\n[download](data:text/html;base64,PHNjcmlwdD4=)');
	assert.doesNotMatch(html, /<script|<img|href=/);
	assert.match(html, /&lt;script&gt;/);
	assert.match(renderMarkdown('```html\n<script>alert(1)</script>\n```'), /&lt;script&gt;/);
});
