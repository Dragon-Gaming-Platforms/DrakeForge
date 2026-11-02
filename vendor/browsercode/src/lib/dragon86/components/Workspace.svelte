<script lang="ts">
	/**
	 * One browser tab per workspace. This component owns the Dragon86/9p source and
	 * the IdeSession; every view (files, search, git, agents, terminal, preview)
	 * is rendered by the VS Code-style shell below. No route opens a second tab.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { appHref } from '$lib/utils/paths';
	import { IdeSession } from '$lib/ide/session.svelte';
	import { POD_HOME } from '$lib/pod/fs';
	import { DEFAULT_REMOTE_ROOT } from '$lib/dragon86/bridge/config';
	import { Dragon86Bridge } from '$lib/dragon86/bridge/dragon86Bridge';
	import { Fs1RemoteFs } from '$lib/dragon86/fs/fs1-remote-fs';
	import { dragon86ProjectSource } from '$lib/dragon86/fs/project-source';
	import { normalizeRemoteRoot } from '$lib/dragon86/fs/remote-fs';
	import { createP9RemoteFs } from '$lib/dragon86/fs/p9-remote-fs';
	import { createStandaloneP9Client } from '$lib/dragon86/p9/worker-client';
	import { resolveToolId } from '$lib/config/tools';
	import WorkspaceShell from './Dragon86IdeShell.svelte';

	type Mode = 'connected' | 'standalone';
	type Activity = 'files' | 'search' | 'git' | 'agents';

	let { mode = 'auto' }: { mode?: Mode | 'auto' } = $props();

	const requestedRoot = $page.url.searchParams.get('root');
	const requestedAgent = $page.url.searchParams.get('agent');
	let effectiveMode = $derived(
		(mode === 'auto'
			? $page.url.searchParams.get('mode') === 'standalone'
				? 'standalone'
				: 'connected'
			: mode) as Mode
	);
	let initialPanel: Activity = $derived(requestedAgent ? 'agents' : 'files');
	let initialAgent = $derived(resolveToolId(requestedAgent ?? undefined));

	let session = $state<IdeSession | null>(null);
	let error = $state<string | null>(null);
	let status = $state('Starting DrakeForge…');
	let peer = $state('Waiting for filesystem');
	let fsState = $state('Booting');

	let root = DEFAULT_REMOTE_ROOT;
	try {
		root = normalizeRemoteRoot(requestedRoot);
	} catch (reason) {
		fsState = reason instanceof Error ? reason.message : String(reason);
	}

	function switchMode(next: Mode): void {
		const url = new URL(appHref('/'), $page.url.origin);
		if (next === 'standalone') url.searchParams.set('mode', 'standalone');
		if (requestedRoot) url.searchParams.set('root', requestedRoot);
		window.location.href = url.href;
	}

	onMount(() => {
		let bridge: Dragon86Bridge | null = null;
		void (async () => {
			try {
				if (effectiveMode === 'connected') {
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
				} else {
					status = 'Starting in-browser 9p server…';
					peer = 'Web Worker · postMessage';
					fsState = 'ZenFS / IndexedDB';
					const client = await createStandaloneP9Client();
					const remote = await createP9RemoteFs(client);
					status = 'Standalone 9p ready';
					const source = dragon86ProjectSource({
						id: 'standalone-9p',
						label: 'standalone-9p-workspace',
						hydrateLabel: 'reading local 9p files',
						remote,
						onStatus: (text) => (fsState = text)
					});
					session = new IdeSession(source);
				}
			} catch (reason) {
				error = reason instanceof Error ? reason.message : String(reason);
				status = 'Workspace failed to start';
				fsState = 'Unavailable';
			}
		})();
		return () => {
			session?.shutdown();
			bridge?.shutdown();
		};
	});
</script>

<div class="df-workspace df-radial-bg">
	{#if session}
		<WorkspaceShell
			{session}
			mode={effectiveMode}
			title="DrakeForge"
			{status}
			{peer}
			fs={fsState}
			{initialPanel}
			{initialAgent}
			onSwitchMode={switchMode}
		/>
	{:else if error}
		<div class="df-workspace-error">
			<div class="df-card">
				<h1 class="df-heading df-glow">Could not start DrakeForge</h1>
				<p>{error}</p>
				<button class="df-btn primary" onclick={() => window.location.reload()}>Reload</button>
			</div>
		</div>
	{:else}
		<div class="df-workspace-loading df-heading">Booting workspace…</div>
	{/if}
</div>

<style>
	.df-workspace {
		position: relative;
		height: 100%;
		width: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	.df-workspace-error,
	.df-workspace-loading {
		display: grid;
		height: 100%;
		place-items: center;
		padding: 24px;
		color: var(--text-secondary);
	}
	.df-workspace-error .df-card {
		display: grid;
		max-width: 32rem;
		gap: 12px;
		padding: 20px;
		text-align: center;
		box-shadow: 0 0 32px rgba(var(--theme-rgb), 0.18);
	}
	.df-workspace-error h1 {
		font-size: 16px;
	}
	.df-workspace-error p {
		font: 12px/1.5 var(--font-mono);
		color: var(--text-secondary);
	}
	.df-workspace-error button {
		justify-self: center;
	}
</style>
