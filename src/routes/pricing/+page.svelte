<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { ArrowLeft, Check, Loader2 } from '@lucide/svelte';
	import { ApiError, joinWaitlist } from '$lib/api';
	import { WAITLIST_INDUSTRIES, waitlistSchema } from '$shared/waitlist';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let firstName = $state('');
	let email = $state('');
	let industry = $state('');
	let website = $state('');
	let ready = $state(false);
	onMount(() => { ready = true; });
	let pending = $state(false);
	let success = $state(false);
	let error = $state('');
	let fields = $state<Record<string, string>>({});
	let controller: AbortController | undefined;
	onDestroy(() => controller?.abort());

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!ready || pending || success) return;
		error = '';
		fields = {};
		const parsed = waitlistSchema.safeParse({ first_name: firstName, email, industry, website });
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				const key = String(issue.path[0]);
				fields[key] ??= issue.message;
			}
			return;
		}
		pending = true;
		controller = new AbortController();
		try {
			await joinWaitlist(parsed.data, controller.signal);
			success = true;
			firstName = ''; email = ''; industry = ''; website = '';
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Your signup was not confirmed. Please check your connection and try again.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Pricing & launch waitlist — Roundtable</title>
	<meta name="description" content="Join the Roundtable waitlist for a special launch discount. Get notified when pricing is available." />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background">
	<header class="mx-auto flex w-full max-w-[1168px] items-center justify-between gap-4 px-6 py-4">
		<a href="/" class="rounded font-serif text-[22px] tracking-[-0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Roundtable</a>
		<ThemeToggle />
	</header>
	<main class="mx-auto w-full max-w-[1168px] flex-1 px-6 pb-12 pt-5 sm:pt-10">
		<a href="/" class="inline-flex items-center gap-2 rounded text-sm text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowLeft class="h-4 w-4" /> Back to workspace</a>
		<div class="mt-8 grid items-start gap-8 lg:grid-cols-2 lg:gap-16">
			<section aria-labelledby="pricing-heading">
				<p class="text-sm text-accent">Pricing · coming at launch</p>
				<h1 id="pricing-heading" class="mt-3 max-w-[18ch] font-serif text-4xl font-normal leading-tight tracking-tight sm:text-5xl">Be first in line for a special launch discount.</h1>
				<p class="mt-5 max-w-lg text-base leading-relaxed text-muted">We’re preparing Roundtable’s launch pricing. Join the waitlist and we’ll contact you when it’s available, with a special discount for early signups.</p>
				<p class="mt-4 text-sm leading-relaxed text-muted">No payment is required to join. Pricing, discount details, and the launch date will be announced later.</p>
			</section>
			<section aria-labelledby="waitlist-heading" class="rounded-md border border-border bg-surface p-5 sm:p-6">
				<h2 id="waitlist-heading" class="font-serif text-2xl font-normal">Join the waitlist</h2>
				{#if success}
					<div role="status" class="mt-5 space-y-3">
						<p class="flex items-center gap-2 font-medium text-accent"><Check class="h-5 w-5" aria-hidden="true" /> You’re on the list.</p>
						<p class="text-sm leading-relaxed text-muted">Thanks for your interest. We’ll contact you at launch with pricing and special-discount details.</p>
						<a href="/" class="inline-block text-sm text-accent underline">Return to your workspace</a>
					</div>
				{:else}
					<noscript><p class="mt-4 text-sm text-muted">Enable JavaScript to join the waitlist.</p></noscript>
					<form id="waitlist-form" method="POST" action="/api/waitlist" onsubmit={submit} aria-busy={pending} class="mt-5 space-y-5">
						<fieldset disabled={!ready || pending} class="min-w-0 space-y-4">
							<legend class="sr-only">Your contact details</legend>
							<div class="space-y-1.5">
								<label for="waitlist-first-name" class="block text-sm font-medium">First name</label>
								<input id="waitlist-first-name" name="first_name" bind:value={firstName} autocomplete="given-name" required maxlength="80" aria-invalid={!!fields.first_name} aria-describedby={fields.first_name ? 'waitlist-first-name-error' : undefined} class="h-11 w-full rounded border border-border bg-surface px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50" />
								{#if fields.first_name}<p id="waitlist-first-name-error" role="alert" class="text-xs text-red-600 dark:text-red-400">{fields.first_name}</p>{/if}
							</div>
							<div class="space-y-1.5">
								<label for="waitlist-email" class="block text-sm font-medium">Email</label>
								<input id="waitlist-email" name="email" type="email" bind:value={email} autocomplete="email" required maxlength="254" aria-invalid={!!fields.email} aria-describedby={fields.email ? 'waitlist-email-error' : undefined} class="h-11 w-full rounded border border-border bg-surface px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50" />
								{#if fields.email}<p id="waitlist-email-error" role="alert" class="text-xs text-red-600 dark:text-red-400">{fields.email}</p>{/if}
							</div>
							<div class="space-y-1.5">
								<label for="waitlist-industry" class="block text-sm font-medium">Industry <span class="font-normal text-muted">(optional)</span></label>
								<select id="waitlist-industry" name="industry" bind:value={industry} aria-invalid={!!fields.industry} aria-describedby={fields.industry ? 'waitlist-industry-error' : undefined} class="h-11 w-full rounded border border-border bg-surface px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50">
									<option value="">Prefer not to say</option>
									{#each WAITLIST_INDUSTRIES as option}<option value={option.value}>{option.label}</option>{/each}
								</select>
								{#if fields.industry}<p id="waitlist-industry-error" role="alert" class="text-xs text-red-600 dark:text-red-400">{fields.industry}</p>{/if}
							</div>
							<div hidden aria-hidden="true"><label for="waitlist-website">Leave this blank</label><input id="waitlist-website" name="website" bind:value={website} tabindex="-1" autocomplete="off" /></div>
							<p class="text-xs leading-relaxed text-muted">By joining, you agree to receive Roundtable launch and special-discount updates at this email. Your industry is optional and helps us understand who is interested.</p>
							<Button type="submit" size="lg" class="w-full" disabled={!ready || pending}>
								{#if pending}<Loader2 class="h-4 w-4 animate-spin" /> Joining…{:else}Join the waitlist{/if}
							</Button>
						</fieldset>
						{#if error}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
					</form>
				{/if}
			</section>
		</div>
	</main>
	<SiteFooter />
</div>
