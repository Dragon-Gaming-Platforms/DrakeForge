<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import Dragon86IdeShell from '$lib/dragon86/components/Dragon86IdeShell.svelte';
	import { IdeSession } from '$lib/ide/session.svelte';
	import { POD_HOME } from '$lib/pod/fs';
	import { appHref } from '$lib/utils/paths';
	import { Dragon86Bridge } from '$lib/dragon86/bridge/dragon86Bridge';
	import { DEFAULT_REMOTE_ROOT } from '$lib/dragon86/bridge/config';
	import { Fs1RemoteFs } from '$lib/dragon86/fs/fs1-remote-fs';
	import { dragon86ProjectSource } from '$lib/dragon86/fs/project-source';
	import { normalizeRemoteRoot } from '$lib/dragon86/fs/remote-fs';
	import Dragon86ModePanel from '$lib/dragon86/components/Dragon86ModePanel.svelte';

	let session = $state<IdeSession | null>(null);
	let error = $state<string | null>(null);
	let status = $state('Starting BrowserCode…');
	let peer = $state('Listening for Dragon86');
	let fsState = $state('Waiting for fs1');
	let detail = $state(
		'In Dragon86, set Settings → Engine → Separate tab to the URL below, then press Reconnect. This tab becomes the engine and the full IDE stays here.'
	);

	const requestedRoot = $page.url.searchParams.get('root');
	let root = DEFAULT_REMOTE_ROOT;
	try {
		root = normalizeRemoteRoot(requestedRoot);
	} catch (reason) {
		detail = reason instanceof Error ? reason.message : String(reason);
	}

	const engineUrl = new URL(appHref('/dragon86'), $page.url.origin);
	if (requestedRoot) engineUrl.searchParams.set('root', requestedRoot);
	const setupUrl = engineUrl.href;
	const otherLabel = 'Standalone 9p';

	onMount(() => {
		let bridge: Dragon86Bridge | null = null;
		void (async () => {
			try {
				bridge = new Dragon86Bridge(POD_HOME, {
					onState: (text) => (status = text),
					onPeer: (text) => (peer = text),
					onFs: (text) => (fsState = text)
				});
				const remote = new Fs1RemoteFs(bridge.fsClient, root);
				const source = dragon86ProjectSource({
					id: 'dragon86',
					label: 'dragon86-workspace',
					hydrateLabel: 'syncing Dragon86 files',
					remote,
					podAttachment: {
						attach: (pod) => bridge!.attach(pod),
						shutdown: () => undefined
					},
					onRemoteLive: () => bridge?.setFsLive(true),
					onStatus: (text) => (fsState = text),
					onShutdown: () => bridge?.shutdown()
				});
				session = new IdeSession(source);
			} catch (reason) {
				error = reason instanceof Error ? reason.message : String(reason);
				status = 'Setup failed';
			}
		})();
		return () => {
			session?.shutdown();
			bridge?.shutdown();
		};
	});
</script>

<div class="dragon86-theme bc-page-bg relative h-full w-full overflow-hidden">
	{#if session}
		<Dragon86IdeShell {session} mode="connected" title="DrakeForge" />
	{:else if !error}
		<div class="flex h-full items-center justify-center text-sm text-bc-mist">Starting…</div>
	{/if}

	{#if error}
		<div class="error-card">
			<h1>Could not start the connected IDE</h1>
			<p>{error}</p>
			<button type="button" onclick={() => window.location.reload()}>Reload</button>
		</div>
	{/if}

	<Dragon86ModePanel
		mode="connected"
		{status}
		{detail}
		{peer}
		fs={fsState}
		{setupUrl}
		{otherLabel}
		showOpenDragon86={true}
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
