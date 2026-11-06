<script lang="ts">
	/**
	 * VS Code-shaped workspace shell, using Dragon86's real design tokens.
	 *
	 * Layout: title/menu bar, activity bar, side bar, editor group, preview group,
	 * bottom panel with VS Code-style tabs, and a Dragon Red status bar. Every
	 * view is inline: files, search, source control, agents, terminal and preview
	 * all live in one browser tab per workspace.
	 */
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import Portal from '$lib/components/Portal.svelte';
	import PodBlockerOverlay from '$lib/components/PodBlockerOverlay.svelte';
	import ZenToggle from '$lib/components/ZenToggle.svelte';
	import EditorPane from '$lib/components/ide/EditorPane.svelte';
	import FileTreePanel from '$lib/components/ide/FileTreePanel.svelte';
	import SearchPanel from '$lib/components/ide/SearchPanel.svelte';
	import TerminalTabs from '$lib/components/ide/TerminalTabs.svelte';
	import LoadingScene from '$lib/components/ide/LoadingScene.svelte';
	import SettingsMenu from '$lib/components/ide/SettingsMenu.svelte';
	import GitPanel from './GitPanel.svelte';
	import AgentsPanel from './AgentsPanel.svelte';
	import type { IdeSession } from '$lib/ide/session.svelte';
	import type { ToolId } from '$lib/config/tools';
	import { downloadProject } from '$lib/ide/download';
	import { PortalState } from '$lib/stores/portals.svelte';
	import { installLeaveGuard } from '$lib/stores/leaveWarning.svelte';
	import { zenState } from '$lib/stores/zen.svelte';
	import { startDrag } from '$lib/utils/drag';
	import { watchIsMobile } from '$lib/utils/viewport';
	import type { PodBlocker } from '$lib/utils/platform';
	import type { BridgeSessionConfig } from '../bridge/session';
	import type { SyncIssue, SyncResolution } from '../fs/synced-workspace-fs';

	type Mode = 'connected' | 'standalone';
	type Activity = 'files' | 'search' | 'git' | 'agents';
	type BottomTab = 'problems' | 'output' | 'debug' | 'sync' | 'terminal' | 'ports';

	type Props = {
		session: IdeSession;
		mode: Mode;
		title?: string;
		status?: string;
		peer?: string;
		fs?: string;
		initialPanel?: Activity;
		initialAgent?: ToolId;
		bridgeSession?: BridgeSessionConfig | null;
		syncIssues?: SyncIssue[];
		onResolveSyncIssue?: (id: string, strategy: SyncResolution) => Promise<void>;
		onSwitchMode: (mode: Mode) => void;
	};

	let {
		session,
		mode,
		title = 'DrakeForge',
		status = '',
		peer = '',
		fs = '',
		initialPanel = 'files',
		initialAgent = 'claude',
		bridgeSession = null,
		syncIssues = [],
		onResolveSyncIssue = () => Promise.resolve(),
		onSwitchMode
	}: Props = $props();

	const menuItems = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'];
	const railItems: { id: Activity; icon: string; label: string }[] = [
		{ id: 'files', icon: 'mingcute:file-line', label: 'Explorer' },
		{ id: 'search', icon: 'mingcute:search-line', label: 'Search' },
		{ id: 'git', icon: 'mingcute:git-branch-line', label: 'Source Control' },
		{ id: 'agents', icon: 'mingcute:ai-line', label: 'Agents' }
	];
	const bottomTabs: { id: BottomTab; label: string; icon: string }[] = [
		{ id: 'problems', label: 'Problems', icon: 'mingcute:warning-line' },
		{ id: 'output', label: 'Output', icon: 'mingcute:file-line' },
		{ id: 'debug', label: 'Debug Console', icon: 'mingcute:bug-line' },
		{ id: 'sync', label: 'Sync', icon: 'mingcute:refresh-line' },
		{ id: 'terminal', label: 'Terminal', icon: 'mingcute:terminal-line' },
		{ id: 'ports', label: 'Ports', icon: 'mingcute:server-line' }
	];

	const portal = new PortalState({ preferredPort: () => session.source.appPort });
	let bootLines = $derived(session.runtime.stages);
	let activeLine = $derived(session.bootStage);
	let previewLive = $derived(portal.frameStatus === 'ready');
	let loaderVisible = $state(true);
	$effect(() => {
		if (!previewLive) loaderVisible = true;
	});

	let modeLabel = $derived(mode === 'connected' ? 'Dragon86 · fs1' : 'Standalone · 9p2000.L');
	let modeIcon = $derived(mode === 'connected' ? 'mingcute:link-line' : 'mingcute:hard-drive-line');
	let statusBranch = $derived(session.source.repo?.ref ?? 'main');
	let statusPort = $derived(portal.selectedPort === null ? 'no port' : `:${portal.selectedPort}`);
	let statusFs = $derived(fs || (session.fsReady ? 'fs ready' : 'booting'));
	let statusPeer = $derived(peer || 'workspace');

	let activePanel = $state<Activity | null>(untrack(() => initialPanel));
	let panelTitle = $derived(
		activePanel === 'files'
			? 'Explorer'
			: activePanel === 'search'
				? 'Search'
				: activePanel === 'git'
					? 'Source Control'
					: activePanel === 'agents'
						? 'Agents'
						: ''
	);
	let bottomTab = $state<BottomTab>('terminal');
	let errorIssues = $derived(syncIssues.filter((issue) => issue.level === 'error'));
	let resolving = $state<string | null>(null);

	let blocker = $state<PodBlocker | null>(null);
	let downloading = $state(false);
	let fileTree = $state<{ startCreate: (kind: 'file' | 'folder') => void } | null>(null);
	let isMobile = $state(false);
	let filePanelWidth = $state(260);
	let terminalHeight = $state(240);
	let dragging = $state<'file' | 'terminal' | null>(null);
	let outputEl = $state<HTMLElement | null>(null);

	const noteTerminalOutput = () => undefined;

	function fitTerminals(): void {
		window.dispatchEvent(new Event('resize'));
	}

	$effect(() => {
		if (bottomTab === 'terminal') setTimeout(() => fitTerminals(), 0);
	});

	function togglePanel(panel: Activity): void {
		activePanel = activePanel === panel ? null : panel;
	}

	function switchMode(): void {
		onSwitchMode(mode === 'connected' ? 'standalone' : 'connected');
	}

	async function resolveIssue(id: string, strategy: SyncResolution): Promise<void> {
		if (resolving) return;
		resolving = id;
		try {
			await onResolveSyncIssue(id, strategy);
		} finally {
			resolving = null;
		}
	}

	function startFileDrag(event: MouseEvent): void {
		dragging = 'file';
		const start = filePanelWidth;
		startDrag(event, {
			cursor: 'col-resize',
			move: (dx, _dy, stop) => {
				const requested = start + dx;
				if (requested < 120) {
					activePanel = null;
					stop();
					return;
				}
				filePanelWidth = Math.max(160, Math.min(420, requested));
				fitTerminals();
			},
			end: () => (dragging = null)
		});
	}

	function startTerminalDrag(event: MouseEvent): void {
		dragging = 'terminal';
		const start = terminalHeight;
		const max = Math.max(320, Math.floor(window.innerHeight * 0.65));
		startDrag(event, {
			cursor: 'row-resize',
			move: (_dx, dy) => {
				terminalHeight = Math.max(120, Math.min(max, start - dy));
				fitTerminals();
			},
			end: () => (dragging = null)
		});
	}

	async function handleDownload(): Promise<void> {
		if (downloading || !session.fsReady) return;
		downloading = true;
		try {
			await downloadProject(session);
		} catch (error) {
			console.error('Failed to download project:', error);
		} finally {
			downloading = false;
		}
	}

	onMount(() => installLeaveGuard());
	onMount(() =>
		watchIsMobile((mobile) => {
			isMobile = mobile;
			if (mobile && activePanel) activePanel = null;
		})
	);
	onMount(async () => {
		blocker = session.runtime.blocker();
		if (blocker) {
			session.loading = false;
			return;
		}
		await tick();
		if (!outputEl) throw new Error('Terminal container is not ready yet');
		await session.boot(outputEl, portal.apply, noteTerminalOutput);
	});

	onDestroy(() => {
		zenState.on = false;
		portal.dispose();
		session.shutdown();
	});
</script>

<div class="df-shell df-radial-bg" data-mode={mode}>
	{#if blocker}
		<PodBlockerOverlay {blocker} />
	{/if}

	<header class="df-titlebar">
		<div class="df-brand">
			<span class="df-logo df-glow"><Icon icon="mingcute:fire-line" width="16" height="16" /></span>
			<span class="df-heading df-glow df-title">{title}</span>
		</div>
		<nav class="df-menu" aria-label="Menu bar">
			{#each menuItems as item (item)}
				<span class="df-menu-item df-heading">{item}</span>
			{/each}
		</nav>
		<div class="df-title-actions">
			<span class="df-mode-chip df-heading">
				<Icon icon={modeIcon} width="11" height="11" />
				{modeLabel}
			</span>
			<button type="button" class="df-btn df-mode-switch" onclick={switchMode}>
				{mode === 'connected' ? 'Standalone' : 'Connect'}
			</button>
		</div>
	</header>

	{#if session.phase === 'failed' || session.saveError || errorIssues.length > 0}
		<div role="alert" class="df-failure">
			<Icon
				icon="mingcute:warning-line"
				width="14"
				height="14"
				class="mt-px shrink-0 text-bc-coral"
			/>
			<div class="min-w-0 flex-1">
				<p class="df-heading">
					{session.phase === 'failed'
						? "Couldn't start the workspace"
						: session.saveError
							? 'A save did not reach Dragon86'
							: 'Filesystem sync needs attention'}
				</p>
				<p class="df-mono">{session.failure ?? session.saveError ?? errorIssues[0]?.message}</p>
				{#if errorIssues.length > 0}
					<p>{errorIssues.length} sync issue(s). Open the Sync panel to resolve conflicts.</p>
				{:else}
					<p>See the Terminal/Output panel below. Reload to try again.</p>
				{/if}
			</div>
			<button class="df-btn primary" onclick={() => (bottomTab = 'sync')}>Sync panel</button>
		</div>
	{/if}

	<div class="df-body" class:is-mobile={isMobile}>
		{#if isMobile && activePanel}
			<button
				type="button"
				aria-label="Close panel"
				class="df-backdrop"
				onclick={() => (activePanel = null)}
			></button>
		{/if}

		<aside class="df-activity" aria-label="Activity bar">
			<div class="df-activity-top">
				{#each railItems as item (item.id)}
					<button
						type="button"
						class="df-rail-btn"
						class:df-active={activePanel === item.id}
						title={item.label}
						aria-label={item.label}
						onclick={() => togglePanel(item.id)}
					>
						<Icon icon={item.icon} width="20" height="20" />
					</button>
				{/each}
			</div>
			<div class="df-activity-bottom">
				<SettingsMenu baseClass="df-rail-btn" activeClass="df-active" idleClass="" size={18} />
				<ZenToggle baseClass="df-rail-btn" activeClass="df-active" idleClass="" size={18} />
			</div>
		</aside>

		{#if activePanel}
			<div class="df-sidebar" style="width: {isMobile ? 280 : filePanelWidth}px;">
				<div class="df-sidebar-header">
					<span class="df-heading">{panelTitle}</span>
					{#if activePanel === 'files'}
						<div class="df-sidebar-actions">
							<button
								type="button"
								title="New file"
								disabled={!session.fsReady}
								onclick={() => fileTree?.startCreate('file')}
								class="df-icon-btn"
							>
								<Icon icon="mingcute:file-new-line" width="14" height="14" />
							</button>
							<button
								type="button"
								title="New folder"
								disabled={!session.fsReady}
								onclick={() => fileTree?.startCreate('folder')}
								class="df-icon-btn"
							>
								<Icon icon="mingcute:new-folder-line" width="14" height="14" />
							</button>
							<button
								type="button"
								title={downloading ? 'Zipping project…' : 'Download workspace'}
								disabled={!session.fsReady || downloading}
								onclick={handleDownload}
								class="df-icon-btn"
							>
								<Icon
									icon={downloading ? 'mingcute:loading-line' : 'mingcute:download-line'}
									class={downloading ? 'animate-spin' : ''}
									width="14"
									height="14"
								/>
							</button>
						</div>
					{/if}
				</div>
				<div class="df-sidebar-body">
					{#if activePanel === 'files'}
						<FileTreePanel
							bind:this={fileTree}
							{session}
							onFileOpen={() => isMobile && (activePanel = null)}
						/>
					{:else if activePanel === 'search'}
						<SearchPanel {session} onFileOpen={() => isMobile && (activePanel = null)} />
					{:else if activePanel === 'git'}
						<GitPanel {session} />
					{:else if activePanel === 'agents'}
						<AgentsPanel initialTool={initialAgent} />
					{/if}
				</div>
			</div>
			<button
				type="button"
				class="df-divider df-divider-col"
				class:active={dragging === 'file'}
				onmousedown={startFileDrag}
				aria-label="Resize side bar"
			>
				<div class="df-divider-line"></div>
			</button>
		{/if}

		<div class="df-main">
			<div class="df-top" class:dragging={dragging !== null}>
				<section class="df-editor-group">
					<div class="df-breadcrumb df-mono">
						<span class="df-heading">{session.source.label}</span>
						{#if session.selectedFile}
							<span>/</span>
							{#each session.selectedFile.split('/') as part (part)}
								<span>{part}</span><span>/</span>
							{/each}
						{/if}
						{#if session.isSaving}<span class="df-glow">saving…</span>{/if}
					</div>
					<div class="df-editor"><EditorPane {session} /></div>
				</section>
				<section class="df-preview" class:pointer-events-none={dragging !== null}>
					<div class="df-preview-header df-heading">Preview</div>
					<div class="df-preview-body">
						{#if portal.portals.length > 0}
							<Portal {portal} onBeforeReload={() => session.saveAll()} showPort={true} />
						{/if}
						{#if loaderVisible}
							<div class="absolute inset-0 z-30" out:fade={{ duration: 460 }}>
								<LoadingScene
									lines={bootLines}
									{activeLine}
									flash={previewLive}
									onFlashComplete={() => (loaderVisible = false)}
								/>
							</div>
						{/if}
					</div>
				</section>
			</div>

			<button
				type="button"
				class="df-divider df-divider-row"
				class:active={dragging === 'terminal'}
				onmousedown={startTerminalDrag}
				aria-label="Resize panel"
			>
				<div class="df-divider-line"></div>
			</button>

			<section class="df-panel" style="height: {terminalHeight}px;">
				<div class="df-panel-tabs">
					{#each bottomTabs as tab (tab.id)}
						<button
							type="button"
							class="df-panel-tab df-mono"
							class:active={bottomTab === tab.id}
							onclick={() => (bottomTab = tab.id)}
						>
							<Icon icon={tab.icon} width="11" height="11" />
							{tab.label}
							{#if tab.id === 'sync' && syncIssues.length > 0}
								<span class="df-sync-badge">{syncIssues.length}</span>
							{/if}
						</button>
					{/each}
					<span class="df-panel-spacer"></span>
					<span class="df-panel-hint df-mono">{statusPort}</span>
				</div>
				<div class="df-panel-body">
					<div class="df-terminal-host" class:df-hidden={bottomTab !== 'terminal'}>
						<TerminalTabs {session} bind:outputEl />
					</div>
					{#if bottomTab === 'problems'}
						<div class="df-panel-placeholder df-mono">
							No problems have been detected in the workspace.
						</div>
					{:else if bottomTab === 'output'}
						<div class="df-panel-placeholder df-mono">
							Use the Output tab in Terminal for build logs.
						</div>
					{:else if bottomTab === 'debug'}
						<div class="df-panel-placeholder df-mono">Debug console is not attached.</div>
					{:else if bottomTab === 'sync'}
						<div class="df-sync-list df-mono">
							{#if session.saveError}
								<div class="df-sync-issue error">
									<strong>Last save</strong>
									<span>{session.saveError}</span>
								</div>
							{/if}
							{#if syncIssues.length === 0}
								<div class="df-sync-empty">
									No sync conflicts or failed writes. Terminal-created files are pushed to Dragon86
									on the next poll.
								</div>
							{:else}
								{#each syncIssues as issue (issue.id)}
									<div class="df-sync-issue" class:error={issue.level === 'error'}>
										<strong>{issue.kind}{issue.path ? ` · ${issue.path}` : ''}</strong>
										<span>{issue.message}</span>
										{#if issue.kind === 'conflict'}
											<div class="df-sync-actions">
												<button
													type="button"
													class="df-btn"
													disabled={resolving === issue.id}
													onclick={() => void resolveIssue(issue.id, 'local')}
												>
													Use BrowserPod copy
												</button>
												<button
													type="button"
													class="df-btn"
													disabled={resolving === issue.id}
													onclick={() => void resolveIssue(issue.id, 'remote')}
												>
													Use Dragon86 copy
												</button>
											</div>
										{/if}
									</div>
								{/each}
							{/if}
						</div>
					{:else if bottomTab === 'ports'}
						<div class="df-port-list df-mono">
							{#if portal.portals.length === 0}
								<div>No forwarded ports yet.</div>
							{:else}
								{#each portal.portals as item (item.port)}
									<div class="df-port-row">
										<span class="df-glow">:{item.port}</span><span>{item.url}</span>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			</section>
		</div>
	</div>

	<footer class="df-statusbar">
		<span class="df-status-item df-heading df-glow">{title}</span>
		<span class="df-status-item df-mono"
			><Icon icon={modeIcon} width="11" height="11" /> {modeLabel}</span
		>
		<span class="df-status-item df-mono"
			><Icon icon="mingcute:git-branch-line" width="11" height="11" /> {statusBranch}</span
		>
		<span class="df-status-item df-mono"
			><Icon icon="mingcute:refresh-line" width="11" height="11" /> {statusFs}</span
		>
		<span class="df-status-item df-mono">{statusPeer}</span>
		{#if bridgeSession}
			<span class="df-status-item df-mono" title={bridgeSession.label}>
				<Icon icon="mingcute:link-line" width="11" height="11" />
				{bridgeSession.dedicated ? bridgeSession.channelName : bridgeSession.label}
			</span>
		{/if}
		{#if syncIssues.length > 0}
			<span class="df-status-item df-mono df-sync-status">
				<Icon icon="mingcute:warning-line" width="11" height="11" />
				{syncIssues.length} sync issue{syncIssues.length === 1 ? '' : 's'}
			</span>
		{/if}
		<span class="df-status-spacer"></span>
		<span class="df-status-item df-mono">{status || 'workspace'}</span>
		<span class="df-status-item df-mono">{session.selectedFile || 'no file'}</span>
		<span class="df-status-item df-mono">{statusPort}</span>
	</footer>
</div>

<style>
	.df-shell {
		position: relative;
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		min-width: 0;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--border-color-light);
		box-shadow:
			0 10px 45px rgba(0, 0, 0, 0.7),
			0 0 25px rgba(var(--theme-rgb), 0.12);
	}
	.df-titlebar {
		display: flex;
		height: 38px;
		flex: 0 0 38px;
		align-items: center;
		gap: 14px;
		border-bottom: 1px solid var(--theme-dim);
		background: rgba(5, 5, 5, 0.92);
		backdrop-filter: blur(20px);
		padding: 0 10px 0 12px;
	}
	.df-brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.df-logo {
		display: grid;
		width: 24px;
		height: 24px;
		place-items: center;
		border: 1px solid rgba(var(--theme-rgb), 0.45);
		border-radius: 6px;
		background: rgba(var(--theme-rgb), 0.1);
		box-shadow: 0 0 12px rgba(var(--theme-rgb), 0.35);
	}
	.df-title {
		font-size: 12px;
	}
	.df-menu {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 12px;
	}
	.df-menu-item {
		font-size: 9px;
		letter-spacing: 0.8px;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.df-title-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.df-mode-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid rgba(var(--theme-rgb), 0.35);
		border-radius: 999px;
		background: rgba(var(--theme-rgb), 0.08);
		padding: 4px 9px;
		font-size: 9px;
		color: var(--theme-bright);
	}
	.df-mode-switch {
		padding: 5px 9px;
		font-size: 0.6rem;
	}
	.df-failure {
		display: flex;
		flex-shrink: 0;
		align-items: flex-start;
		gap: 10px;
		border-bottom: 1px solid rgba(255, 107, 107, 0.4);
		background: rgba(255, 107, 107, 0.08);
		padding: 8px 12px;
		font: 11px/1.45 var(--font-mono);
	}
	.df-failure p {
		margin: 0;
	}
	.df-failure p:first-child {
		font-size: 11px;
	}
	.df-failure p:last-child {
		color: var(--text-dim);
	}
	.df-body {
		position: relative;
		display: flex;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-activity {
		display: flex;
		width: 48px;
		flex: 0 0 48px;
		flex-direction: column;
		justify-content: space-between;
		border-right: 1px solid var(--border-color);
		background: var(--vs-activity);
		padding: 8px 6px;
	}
	.df-activity-top,
	.df-activity-bottom {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	:global(.df-rail-btn) {
		display: grid;
		width: 36px;
		height: 36px;
		place-items: center;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
		transition: var(--t-fast);
	}
	:global(.df-rail-btn:hover) {
		background: rgba(var(--theme-rgb), 0.12);
		color: var(--text-primary);
	}
	.df-sidebar {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		min-height: 0;
		background: var(--vs-sidebar);
	}
	.df-sidebar-header {
		display: flex;
		height: 34px;
		flex: 0 0 34px;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-color);
		padding: 0 10px;
		font-size: 10px;
		color: var(--text-secondary);
	}
	.df-sidebar-actions {
		display: flex;
		gap: 3px;
	}
	.df-icon-btn {
		display: grid;
		width: 24px;
		height: 24px;
		place-items: center;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	.df-icon-btn:hover:not(:disabled) {
		background: rgba(var(--theme-rgb), 0.12);
		color: var(--theme-bright);
	}
	.df-icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.df-sidebar-body {
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-main {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1;
		flex-direction: column;
	}
	.df-top {
		display: flex;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-top.dragging .df-preview {
		pointer-events: none;
	}
	.df-editor-group {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1.15 1 0;
		flex-direction: column;
		overflow: hidden;
		border-right: 1px solid var(--vs-border);
		background: var(--vs-editor);
	}
	.df-breadcrumb {
		display: flex;
		height: 24px;
		flex: 0 0 24px;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		border-bottom: 1px solid var(--border-color);
		background: var(--bg-card);
		padding: 0 10px;
		font-size: 10px;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.df-breadcrumb .df-heading {
		font-size: 9px;
		color: var(--text-secondary);
	}
	.df-editor {
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-preview {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 0.85 1 0;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-dark);
	}
	.df-preview-header {
		display: flex;
		height: 24px;
		flex: 0 0 24px;
		align-items: center;
		border-bottom: 1px solid var(--border-color);
		background: var(--vs-tab-inactive);
		padding: 0 10px;
		font-size: 9px;
		color: var(--text-dim);
	}
	.df-preview-body {
		position: relative;
		min-height: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.df-panel {
		display: flex;
		min-height: 0;
		flex-shrink: 0;
		flex-direction: column;
		border-top: 1px solid var(--border-color);
		background: var(--vs-panel);
		overflow: hidden;
	}
	.df-panel-tabs {
		display: flex;
		height: 30px;
		flex: 0 0 30px;
		align-items: center;
		gap: 2px;
		border-bottom: 1px solid var(--border-color);
		background: var(--bg-darkest);
		padding: 0 8px;
	}
	.df-panel-tab {
		display: inline-flex;
		height: 100%;
		align-items: center;
		gap: 5px;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		padding: 0 10px;
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
		cursor: pointer;
	}
	.df-panel-tab:hover {
		color: var(--text-secondary);
	}
	.df-panel-tab.active {
		border-bottom-color: var(--theme-primary);
		color: var(--text-primary);
		background: rgba(var(--theme-rgb), 0.08);
	}
	.df-panel-spacer {
		flex: 1;
	}
	.df-panel-hint {
		font-size: 10px;
		color: var(--text-dim);
	}
	.df-panel-body {
		position: relative;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-terminal-host {
		position: absolute;
		inset: 0;
	}
	.df-hidden {
		visibility: hidden;
		pointer-events: none;
	}
	.df-panel-placeholder,
	.df-port-list {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 10px 12px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.df-port-row {
		display: flex;
		gap: 12px;
		padding: 4px 0;
	}
	.df-divider {
		position: relative;
		z-index: 10;
		flex-shrink: 0;
		border: none;
		background: transparent;
		padding: 0;
	}
	.df-divider-col {
		width: 5px;
		cursor: col-resize;
	}
	.df-divider-row {
		height: 5px;
		cursor: row-resize;
	}
	.df-divider-line {
		position: absolute;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--text-dim) 30%, transparent);
		transition: 0.15s ease;
	}
	.df-divider-col .df-divider-line {
		top: 0;
		bottom: 0;
		left: 2px;
		width: 1px;
	}
	.df-divider-row .df-divider-line {
		left: 0;
		right: 0;
		top: 2px;
		height: 1px;
	}
	.df-divider:hover .df-divider-line,
	.df-divider.active .df-divider-line {
		background: var(--theme-primary);
		box-shadow: 0 0 8px rgba(var(--theme-rgb), 0.5);
	}
	.df-statusbar {
		display: flex;
		height: 26px;
		flex: 0 0 26px;
		align-items: center;
		gap: 14px;
		background: var(--vs-statusbar);
		border-top: 1px solid var(--theme-primary);
		padding: 0 10px;
		box-shadow: 0 -4px 18px rgba(var(--theme-rgb), 0.25);
		font-size: 10px;
		color: #fff;
	}
	.df-status-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.df-status-spacer {
		flex: 1;
	}
	.df-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: none;
		background: rgba(0, 0, 0, 0.55);
	}
	.df-sync-badge {
		display: inline-grid;
		min-width: 16px;
		height: 16px;
		place-items: center;
		border-radius: 999px;
		background: var(--theme-primary);
		color: #fff;
		font-size: 9px;
		box-shadow: 0 0 8px rgba(var(--theme-rgb), 0.5);
	}
	.df-sync-list {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 10px 12px;
		font-size: 11px;
	}
	.df-sync-empty {
		color: var(--text-dim);
	}
	.df-sync-issue {
		display: grid;
		gap: 4px;
		margin-bottom: 8px;
		border: 1px solid var(--border-color-light);
		border-radius: 6px;
		background: var(--bg-card);
		padding: 8px 10px;
	}
	.df-sync-issue.error {
		border-color: rgba(255, 107, 107, 0.5);
		background: rgba(255, 107, 107, 0.06);
	}
	.df-sync-issue strong {
		font-family: var(--font-heading);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--theme-bright);
	}
	.df-sync-issue span {
		color: var(--text-secondary);
	}
	.df-sync-actions {
		display: flex;
		gap: 6px;
		margin-top: 4px;
	}
	.df-sync-actions .df-btn {
		padding: 4px 8px;
		font-size: 0.6rem;
	}
	.df-sync-status {
		color: #ffd479;
	}
	@media (max-width: 900px) {
		.df-menu {
			display: none;
		}
		.df-mode-chip {
			display: none;
		}
		.df-top {
			flex-direction: column;
		}
		.df-editor-group {
			flex: 1 1 55%;
			border-right: 0;
			border-bottom: 1px solid var(--vs-border);
		}
		.df-preview {
			flex: 1 1 45%;
		}
		.df-body.is-mobile .df-sidebar {
			position: fixed;
			top: 38px;
			bottom: 26px;
			left: 48px;
			z-index: 30;
			box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
		}
		.df-body.is-mobile .df-divider-col {
			display: none;
		}
		.df-status-item:nth-child(n + 8) {
			display: none;
		}
	}
</style>
