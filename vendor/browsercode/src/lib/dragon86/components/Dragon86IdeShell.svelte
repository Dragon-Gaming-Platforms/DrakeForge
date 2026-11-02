<script lang="ts">
	/**
	 * VS Code-style shell for the DrakeForge connected and standalone IDE routes.
	 *
	 * It reuses BrowserCode's real EditorPane, FileTreePanel, SearchPanel,
	 * TerminalTabs, Portal preview and IdeSession boot pipeline. Only the chrome
	 * is new: a Dragon Red activity bar with Files / Search / Git / Agents views,
	 * editor + preview side by side, a full-width terminal panel at the bottom,
	 * and a status bar. The upstream IdeShell remains untouched for /ide and /embed.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
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
	import { downloadProject } from '$lib/ide/download';
	import { PortalState } from '$lib/stores/portals.svelte';
	import { installLeaveGuard } from '$lib/stores/leaveWarning.svelte';
	import { zenState } from '$lib/stores/zen.svelte';
	import { startDrag } from '$lib/utils/drag';
	import { watchIsMobile } from '$lib/utils/viewport';
	import type { PodBlocker } from '$lib/utils/platform';

	type Props = {
		session: IdeSession;
		mode: 'connected' | 'standalone';
		title?: string;
	};
	let { session, mode, title = 'DrakeForge' }: Props = $props();

	type Activity = 'files' | 'search' | 'git' | 'agents';

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
	let statusFs = $derived(session.fsReady ? 'fs ready' : 'booting');
	let statusPort = $derived(portal.selectedPort === null ? 'no port' : `:${portal.selectedPort}`);

	let blocker = $state<PodBlocker | null>(null);
	let downloading = $state(false);
	let activePanel = $state<Activity | null>('files');
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
	let fileTree = $state<{ startCreate: (kind: 'file' | 'folder') => void } | null>(null);
	let isMobile = $state(false);
	let filePanelWidth = $state(240);
	let terminalHeight = $state(230);
	let dragging = $state<'file' | 'terminal' | null>(null);
	let outputEl = $state<HTMLElement | null>(null);

	const noteTerminalOutput = () => undefined;

	function fitTerminals(): void {
		window.dispatchEvent(new Event('resize'));
	}

	function togglePanel(panel: Activity): void {
		activePanel = activePanel === panel ? null : panel;
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

<div class="df-shell dragon86-theme" data-mode={mode}>
	{#if blocker}
		<PodBlockerOverlay {blocker} />
	{/if}

	<!-- ── Title bar ─────────────────────────────────────────────────────── -->
	<header class="df-header">
		<div class="df-brand">
			<span class="df-logo df-glow"><Icon icon="mingcute:fire-line" width="16" height="16" /></span>
			<span class="df-title df-glow">{title}</span>
		</div>
		<span class="df-header-sep"></span>
		<div class="df-breadcrumb">
			<span class="truncate text-bc-text">{session.source.label}</span>
			{#if session.selectedFile}
				<span class="text-bc-icon">/</span>
				<span class="truncate text-bc-text">{session.selectedFile}</span>
			{/if}
			{#if session.isSaving}<span class="ml-1 shrink-0 text-bc-text-muted">saving…</span>{/if}
		</div>
		<div class="df-header-mode">
			<Icon icon={modeIcon} width="12" height="12" />
			<span>{modeLabel}</span>
		</div>
	</header>

	{#if session.phase === 'failed'}
		<div role="alert" class="df-failure">
			<Icon
				icon="mingcute:warning-line"
				width="14"
				height="14"
				class="mt-px shrink-0 text-bc-coral"
			/>
			<div class="min-w-0 flex-1">
				<p class="font-medium text-bc-text">Couldn't start the project</p>
				<p class="mt-0.5 break-words text-bc-text-muted">{session.failure}</p>
				<p class="mt-0.5 text-bc-text-muted">See the Output terminal below. Reload to try again.</p>
			</div>
			<button onclick={() => location.reload()} class="df-reload">Reload</button>
		</div>
	{/if}

	<!-- ── Body ─────────────────────────────────────────────────────────── -->
	<div class="df-body" class:is-mobile={isMobile}>
		{#if isMobile && activePanel}
			<button
				type="button"
				aria-label="Close panel"
				class="df-backdrop"
				onclick={() => (activePanel = null)}
			></button>
		{/if}

		<aside class="df-rail" aria-label="Activity bar">
			<div class="df-rail-top">
				<button
					type="button"
					class="df-rail-btn"
					class:df-active={activePanel === 'files'}
					title="Files"
					aria-label="Files"
					onclick={() => togglePanel('files')}
				>
					<Icon icon="mingcute:file-line" width="19" height="19" />
				</button>
				<button
					type="button"
					class="df-rail-btn"
					class:df-active={activePanel === 'search'}
					title="Search"
					aria-label="Search"
					onclick={() => togglePanel('search')}
				>
					<Icon icon="mingcute:search-line" width="19" height="19" />
				</button>
				<button
					type="button"
					class="df-rail-btn"
					class:df-active={activePanel === 'git'}
					title="Source Control"
					aria-label="Source Control"
					onclick={() => togglePanel('git')}
				>
					<Icon icon="mingcute:git-branch-line" width="19" height="19" />
				</button>
				<button
					type="button"
					class="df-rail-btn"
					class:df-active={activePanel === 'agents'}
					title="Agents"
					aria-label="Agents"
					onclick={() => togglePanel('agents')}
				>
					<Icon icon="mingcute:ai-line" width="19" height="19" />
				</button>
			</div>
			<div class="df-rail-bottom">
				<SettingsMenu baseClass="df-rail-btn" activeClass="df-active" idleClass="" size={18} />
				<ZenToggle baseClass="df-rail-btn" activeClass="df-active" idleClass="" size={18} />
			</div>
		</aside>

		{#if activePanel}
			<div class="df-side" style="width: {isMobile ? 260 : filePanelWidth}px;">
				<div class="df-side-header">
					<span>{panelTitle}</span>
					{#if activePanel === 'files'}
						<div class="flex items-center gap-0.5">
							<button
								type="button"
								title="New file"
								disabled={!session.fsReady}
								onclick={() => fileTree?.startCreate('file')}
								class="df-icon-btn"
							>
								<Icon icon="mingcute:file-new-line" width="13" height="13" />
							</button>
							<button
								type="button"
								title="New folder"
								disabled={!session.fsReady}
								onclick={() => fileTree?.startCreate('folder')}
								class="df-icon-btn"
							>
								<Icon icon="mingcute:new-folder-line" width="13" height="13" />
							</button>
							<button
								type="button"
								title={downloading ? 'Zipping project…' : 'Download project as a zip'}
								disabled={!session.fsReady || downloading}
								onclick={handleDownload}
								class="df-icon-btn"
							>
								<Icon
									icon={downloading ? 'mingcute:loading-line' : 'mingcute:download-line'}
									class={downloading ? 'animate-spin' : ''}
									width="13"
									height="13"
								/>
							</button>
						</div>
					{/if}
				</div>
				<div class="df-side-body">
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
						<AgentsPanel />
					{/if}
				</div>
			</div>
			<button
				type="button"
				class="df-divider df-divider-col"
				class:active={dragging === 'file'}
				onmousedown={startFileDrag}
				aria-label="Resize side panel"
			>
				<div class="df-divider-line"></div>
			</button>
		{/if}

		<div class="df-main">
			<div class="df-top" class:dragging={dragging !== null}>
				<div class="df-editor"><EditorPane {session} /></div>
				<div class="df-preview" class:pointer-events-none={dragging !== null}>
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
			</div>

			<button
				type="button"
				class="df-divider df-divider-row"
				class:active={dragging === 'terminal'}
				onmousedown={startTerminalDrag}
				aria-label="Resize terminal panel"
			>
				<div class="df-divider-line"></div>
			</button>

			<div class="df-terminal" style="height: {terminalHeight}px;">
				<TerminalTabs {session} bind:outputEl />
			</div>
		</div>
	</div>

	<!-- ── Status bar ───────────────────────────────────────────────────── -->
	<footer class="df-statusbar">
		<span class="df-status-item df-glow">{title}</span>
		<span class="df-status-item"><Icon icon={modeIcon} width="11" height="11" /> {modeLabel}</span>
		<span class="df-status-item"
			><Icon icon="mingcute:git-branch-line" width="11" height="11" /> {statusBranch}</span
		>
		<span class="df-status-item"
			><Icon icon="mingcute:refresh-line" width="11" height="11" /> {statusFs}</span
		>
		<span class="df-status-spacer"></span>
		<span class="df-status-item"
			><Icon icon="mingcute:server-line" width="11" height="11" /> {statusPort}</span
		>
		<span class="df-status-item">{session.selectedFile || 'no file selected'}</span>
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
		background:
			radial-gradient(ellipse at 15% -10%, rgba(var(--dragon86-rgb), 0.14), transparent 55%),
			var(--color-bc-abyss);
	}
	.df-header {
		display: flex;
		height: 44px;
		flex: 0 0 44px;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--color-bc-border);
		background: var(--color-bc-navy);
		padding: 0 12px;
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
		border: 1px solid rgba(var(--dragon86-rgb), 0.55);
		border-radius: 7px;
		background: rgba(var(--dragon86-rgb), 0.12);
		box-shadow: 0 0 14px rgba(var(--dragon86-rgb), 0.25);
	}
	.df-title {
		font-size: 13px;
	}
	.df-header-sep {
		width: 1px;
		height: 18px;
		flex-shrink: 0;
		background: var(--color-bc-border);
	}
	.df-breadcrumb {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}
	.df-header-mode {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		border: 1px solid rgba(var(--dragon86-rgb), 0.35);
		border-radius: 999px;
		background: rgba(var(--dragon86-rgb), 0.08);
		padding: 4px 9px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-bc-azure);
	}
	.df-failure {
		display: flex;
		flex-shrink: 0;
		align-items: flex-start;
		gap: 10px;
		border-bottom: 1px solid rgba(255, 107, 107, 0.4);
		background: rgba(255, 107, 107, 0.08);
		padding: 8px 12px;
		font:
			11px/1.45 ui-monospace,
			monospace;
	}
	.df-reload {
		flex-shrink: 0;
		border: 1px solid var(--color-bc-border);
		border-radius: 7px;
		background: var(--color-bc-surface);
		color: var(--color-bc-text);
		padding: 4px 9px;
		cursor: pointer;
	}
	.df-body {
		position: relative;
		display: flex;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}
	.df-rail {
		display: flex;
		width: 48px;
		flex: 0 0 48px;
		flex-direction: column;
		justify-content: space-between;
		border-right: 1px solid var(--color-bc-border);
		background: var(--color-bc-navy);
		padding: 8px 6px;
	}
	.df-rail-top,
	.df-rail-bottom {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	:global(.df-rail-btn) {
		display: grid;
		width: 36px;
		height: 36px;
		place-items: center;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-bc-icon);
		cursor: pointer;
		transition: 0.15s ease;
	}
	:global(.df-rail-btn:hover) {
		background: rgba(var(--dragon86-rgb), 0.08);
		color: var(--color-bc-text);
	}
	.df-side {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		min-height: 0;
		background: var(--color-bc-surface);
	}
	.df-side-header {
		display: flex;
		height: 34px;
		flex: 0 0 34px;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--color-bc-border);
		padding: 0 10px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-bc-text-muted);
	}
	.df-side-body {
		min-height: 0;
		flex: 1;
		overflow: hidden;
		padding: 5px;
	}
	.df-icon-btn {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-bc-icon);
		cursor: pointer;
	}
	.df-icon-btn:hover:not(:disabled) {
		background: rgba(var(--dragon86-rgb), 0.12);
		color: var(--color-bc-azure);
	}
	.df-icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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
	.df-editor {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1.15 1 0;
		flex-direction: column;
		overflow: hidden;
	}
	.df-preview {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 0.85 1 0;
		flex-direction: column;
		border-left: 1px solid var(--color-bc-border);
		overflow: hidden;
	}
	.df-terminal {
		min-height: 0;
		flex-shrink: 0;
		border-top: 1px solid var(--color-bc-border);
		background: var(--color-bc-terminal);
		overflow: hidden;
	}
	.df-divider {
		position: relative;
		flex-shrink: 0;
		z-index: 10;
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
		background: color-mix(in srgb, var(--color-bc-mist) 12%, transparent);
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
		background: var(--color-bc-azure);
		box-shadow: 0 0 8px rgba(var(--dragon86-rgb), 0.5);
	}
	.df-statusbar {
		display: flex;
		height: 24px;
		flex: 0 0 24px;
		align-items: center;
		gap: 14px;
		border-top: 1px solid var(--color-bc-border);
		background: var(--color-bc-statusbar);
		padding: 0 10px;
		font-size: 10px;
		color: var(--color-bc-text-muted);
	}
	.df-status-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
		overflow: hidden;
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
	@media (max-width: 900px) {
		.df-header-mode {
			display: none;
		}
		.df-top {
			flex-direction: column;
		}
		.df-editor {
			flex: 1 1 55%;
		}
		.df-preview {
			flex: 1 1 45%;
			border-left: 0;
			border-top: 1px solid var(--color-bc-border);
		}
		.df-body.is-mobile .df-side {
			position: fixed;
			top: 44px;
			bottom: 24px;
			left: 48px;
			z-index: 30;
			box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
		}
		.df-body.is-mobile .df-divider-col {
			display: none;
		}
		.df-status-item:nth-child(n + 4) {
			display: none;
		}
	}
</style>
