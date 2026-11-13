<script lang="ts">
	/**
	 * Root alias. `?mode=standalone` is kept for old links, but it now redirects
	 * to the dedicated /standalone route so route-local COI policy applies to
	 * every standalone entry point. The connected workspace stays here.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { appHref } from '$lib/utils/paths';
	import Workspace from '$lib/dragon86/components/Workspace.svelte';

	let redirecting = $state(false);

	onMount(() => {
		if ($page.url.searchParams.get('mode') !== 'standalone') return;
		redirecting = true;
		const target = new URL(appHref('/standalone'), $page.url.origin);
		$page.url.searchParams.forEach((value, key) => {
			if (key !== 'mode' && key !== 'channel') target.searchParams.set(key, value);
		});
		window.location.replace(target.href);
	});
</script>

{#if redirecting}
	<div class="df-redirect df-radial-bg">Opening standalone DrakeForge…</div>
{:else}
	<Workspace />
{/if}

<style>
	.df-redirect {
		display: grid;
		height: 100%;
		place-items: center;
		color: var(--text-secondary);
		font: 13px/1.5 var(--font-mono);
	}
</style>
