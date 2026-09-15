import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { isTheme } from '../src/lib/theme.ts';

const html = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const css = await readFile(new URL('../src/routes/layout.css', import.meta.url), 'utf8');

for (const [saved, systemDark, expected] of [
	[null, false, 'light'], [null, true, 'dark'],
	['light', true, 'light'], ['dark', false, 'dark'],
	['invalid', true, 'dark'], ['system', false, 'light']
]) {
	test(`pre-paint theme: saved=${saved}, systemDark=${systemDark}`, () => {
		const document = { documentElement: { dataset: {} } };
		runInNewContext(bootstrap, {
			document,
			localStorage: { getItem: key => { assert.equal(key, 'roundtable-theme'); return saved; } },
			window: { matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return { matches: systemDark }; } }
		});
		assert.equal(document.documentElement.dataset.theme, expected);
	});
}

test('pre-paint theme tolerates denied access to localStorage itself', () => {
	const document = { documentElement: { dataset: {} } };
	const context = { document, window: { matchMedia: () => ({ matches: true }) } };
	Object.defineProperty(context, 'localStorage', { get() { throw new Error('Storage blocked'); } });
	runInNewContext(bootstrap, context);
	assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('only explicit light/dark values are accepted', () => {
	assert.equal(isTheme('light'), true);
	assert.equal(isTheme('dark'), true);
	for (const value of [null, undefined, 'system', 'invalid', '', {}, 1]) assert.equal(isTheme(value), false);
});

test('light palette and typography follow the Policy Observatory reference', () => {
	const light = css.slice(css.indexOf(':root {')).split('}')[0];
	for (const token of ['--background: #f2f4f3;', '--foreground: #1c2a2e;', '--primary: #1f5c4a;', '--border: #c9d1ce;', '--accent-soft: #d8ebe1;']) assert.ok(light.includes(token), token);
	assert.ok(css.includes("--font-serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;"));
	assert.ok(css.includes("--font-sans: 'Helvetica Neue', Helvetica, Arial, sans-serif;"));
	assert.equal(/gradient\(|--gold/.test(css), false, 'No decorative gradients or gold theme tokens');
});

function luminance(hex) {
	const rgb = hex.match(/[a-f\d]{2}/gi).map(channel => {
		const s = parseInt(channel, 16) / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
for (const selector of [':root', ":root[data-theme='dark']"]) {
	test(`${selector} semantic text pairs meet WCAG AA normal-text contrast`, () => {
		const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
		const colors = Object.fromEntries([...block.matchAll(/--([\w-]+): (#[a-f\d]{6});/gi)].map(m => [m[1], m[2]]));
		const pairs = [
			['foreground', 'background'], ['foreground', 'surface'], ['foreground', 'surface-muted'],
			['muted', 'background'], ['muted', 'surface'], ['muted', 'surface-muted'],
			['muted', 'accent-soft'],
			['primary-foreground', 'primary'], ['primary', 'background'],
			['accent', 'surface'], ['accent', 'accent-soft'],
			['warning', 'surface'], ['warning', 'surface-muted']
		];
		for (const [text, background] of pairs) {
			const [lighter, darker] = [luminance(colors[text]), luminance(colors[background])].sort((a, b) => b - a);
			const ratio = (lighter + 0.05) / (darker + 0.05);
			assert.ok(ratio >= 4.5, `${text} on ${background}: ${ratio.toFixed(2)}:1`);
		}
	});
}
