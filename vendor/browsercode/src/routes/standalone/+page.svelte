<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import IdeShell from '$lib/components/ide/IdeShell.svelte';
	import { IdeSession } from '$lib/ide/session.svelte';
	import { appHref } from '$lib/utils/paths';
	import { dragon86ProjectSource } from '$lib/dragon86/fs/project-source';
	import { createP9RemoteFs } from '$lib/dragon86/fs/p9-remote-fs';
	import { createStandaloneP9Client } from '$lib/dragon86/p9/worker-client';
	import Dragon86ModePanel from '$lib/dragon86/components/Dragon86ModePanel.svelte';

	let session = $state<IdeSession | null>(null);
	let error = $state<string | null>(null);
	let status = $state('Starting standalone 9p server…');
	let peer = $state('In-page 9p Worker · postMessage frames');
	let fsState = $state('Configuring ZenFS / IndexedDB');
	let detail = $state(
		'No Dragon86 tab is needed. Dragon86’s real 9p2000.L handler runs in a Web Worker against a persistent ZenFS IndexedDB mount; files are mirrored into BrowserPod.'
	);

	const setupUrl = new URL(appHref('/standalone'), $page.url.origin).href;
	const otherLabel = 'Connect to Dragon86';

	onMount(() => {
		void (async () => {
			try {
				const client = await createStandaloneP9Client();
				const remote = await createP9RemoteFs(client);
				status = 'Standalone 9p server ready';
				fsState = '9p2000.L · ZenFS IndexedDB';
				const source = dragon86ProjectSource({
					id: 'standalone-9p',
					label: 'standalone-9p-workspace',
					hydrateLabel: 'reading local 9p files',
					remote,
					onStatus: (text) => (fsState = text),
					onShutdown: () => undefined
				});
				session = new IdeSession(source);
			} catch (reason) {
				error = reason instanceof Error ? reason.message : String(reason);
				status = '9p server failed';
				fsState = 'Worker unavailable';
			}
		})();
		return () => session?.shutdown();
	});
</script>

<div class="bc-page-bg relative h-full w-full overflow-hidden">
	{#if session}
		<IdeShell {session} />
	{:else if !error}
		<div class="flex h-full items-center justify-center text-sm text-bc-mist">
			Mounting standalone 9p filesystem…
		</div>
	{/if}

	{#if error}
		<div class="error-card">
			<h1>Could not start the standalone 9p server</h1>
			<p>{error}</p>
			<button type="button" onclick={() => window.location.reload()}>Reload</button>
		</div>
	{/if}

	<Dragon86ModePanel
		mode="standalone"
		{status}
		{detail}
		{peer}
		fs={fsState}
		{setupUrl}
		{otherLabel}
		showOpenDragon86={false}
	/>
</div>

<style>
	.error-card {
		position: absolute;
		inset: 0;
		z-index: 50;
		display: grid;
		place-content: center;
		gap: 12px;
		padding: 24px;
		background: var(--color-bc-abyss);
		color: var(--color-bc-text);
		text-align: center;
	}
	.error-card h1 {
		font-size: 18px;
	}
	.error-card p {
		color: var(--color-bc-mist);
	}
	.error-card button {
		justify-self: center;
		padding: 8px 14px;
		border: 1px solid var(--color-bc-border);
		border-radius: 10px;
		background: var(--color-bc-navy);
		color: var(--color-bc-text);
		cursor: pointer;
	}
</style>
