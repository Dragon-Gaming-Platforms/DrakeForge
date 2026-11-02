<script lang="ts">
	import './layout.css';
	import '$lib/dragon86/theme.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { appHref } from '$lib/utils/paths';

	let { children } = $props();

	// Single-workspace shell: Chrome, ribbon, tour and separate landing/agent pages are gone.
	// Every route renders one IDE workspace in one browser tab.
	const pageTitle = 'DrakeForge';
	const pageDescription =
		'DrakeForge — a Dragon86-themed VS Code workspace for BrowserCode, with a live fs1 link to Dragon86 or a bundled 9p server.';
	let pageUrl = $derived($page.url.href);
	let ogImage = $derived(`${$page.url.origin}${appHref('/og-v2.png')}`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
	<meta name="description" content={pageDescription} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={pageUrl} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
	<meta name="twitter:image" content={ogImage} />
	<meta property="twitter:domain" content={$page.url.host} />
	<meta property="twitter:url" content={pageUrl} />
</svelte:head>

<div class="df-app df-radial-bg">
	<main class="df-app-main">{@render children()}</main>
</div>

<style>
	.df-app {
		display: flex;
		height: 100dvh;
		width: 100vw;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-darkest);
		color: var(--text-primary);
	}
	.df-app-main {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
</style>
