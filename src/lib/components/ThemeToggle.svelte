<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { getContext } from 'svelte';
	import { THEME_CONTEXT, type ThemeContext } from '$lib/theme';

	const theme = getContext<ThemeContext>(THEME_CONTEXT);
</script>

<button
	type="button"
	role="switch"
	aria-label="Dark mode"
	aria-checked={theme.dark}
	disabled={!theme.ready}
	title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
	onclick={theme.toggle}
	class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded border border-border bg-transparent px-3 py-2 text-sm font-normal text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
>
	{#if theme.dark}<Moon class="h-4 w-4" aria-hidden="true" />{:else}<Sun class="h-4 w-4" aria-hidden="true" />{/if}
	<span>{theme.dark ? 'Dark mode' : 'Light mode'}</span>
</button>
