<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, setContext } from 'svelte';
	import { isTheme, THEME_CONTEXT, THEME_STORAGE_KEY, type Theme, type ThemeContext } from '$lib/theme';

	let { children } = $props();
	let dark = $state(false);
	let ready = $state(false);
	let preference: Theme | null = null;

	function apply(theme: Theme) {
		dark = theme === 'dark';
		document.documentElement.dataset.theme = theme;
	}

	setContext<ThemeContext>(THEME_CONTEXT, {
		get dark() { return dark; },
		get ready() { return ready; },
		toggle() {
			preference = dark ? 'light' : 'dark';
			apply(preference);
			try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Keep the choice for this visit. */ }
		}
	});

	onMount(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		try {
			const saved = localStorage.getItem(THEME_STORAGE_KEY);
			preference = isTheme(saved) ? saved : null;
		} catch { /* Fall back to the device preference. */ }
		const sync = () => apply(preference ?? (media.matches ? 'dark' : 'light'));
		const storageChanged = (event: StorageEvent) => {
			if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
			try { if (event.storageArea !== localStorage) return; } catch { return; }
			preference = isTheme(event.newValue) ? event.newValue : null;
			sync();
		};
		sync();
		ready = true;
		media.addEventListener('change', sync);
		window.addEventListener('storage', storageChanged);
		return () => {
			media.removeEventListener('change', sync);
			window.removeEventListener('storage', storageChanged);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Roundtable v2</title>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	{@render children()}
</div>
