<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { IdeSession } from '$lib/ide/session.svelte';

	let { session }: { session: IdeSession } = $props();

	let message = $state('Update from DrakeForge');
	let busy = $state(false);

	let branch = $derived(session.source.repo?.ref ?? 'main');
	let repoLabel = $derived(session.source.repo?.url ?? 'Dragon86 workspace');
	let dirtyFiles = $derived(
		session.openFiles.filter((file) => file.content !== file.savedContent).map((file) => file.path)
	);

	async function run(args: string[]): Promise<void> {
		if (busy || !session.fsReady) return;
		busy = true;
		try {
			await session.runGit(args);
		} finally {
			busy = false;
		}
	}

	function commit(): void {
		const text = message.trim() || 'Update from DrakeForge';
		void run(['commit', '-m', text]);
	}
</script>

<div class="df-git-view">
	<div class="df-card df-git-card">
		<div class="df-heading df-git-label">Repository</div>
		<div class="df-mono df-git-repo">{repoLabel}</div>
		<div class="df-git-branch">
			<Icon icon="mingcute:git-branch-line" width="13" height="13" />
			<span class="df-mono">{branch}</span>
		</div>
	</div>

	<div class="df-card df-git-card">
		<div class="df-heading df-git-label">Unsaved buffers</div>
		{#if dirtyFiles.length === 0}
			<div class="df-git-empty">No unsaved editor tabs.</div>
		{:else}
			<ul class="df-git-list">
				{#each dirtyFiles as file (file)}
					<li class="df-mono">
						<Icon icon="mingcute:edit-line" width="11" height="11" />
						<span>{file}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<label class="df-card df-git-card df-git-message">
		<span class="df-heading df-git-label">Commit message</span>
		<input
			bind:value={message}
			type="text"
			placeholder="Update from DrakeForge"
			class="df-input df-mono"
		/>
	</label>

	<div class="df-git-actions">
		<button class="df-btn" disabled={busy || !session.fsReady} onclick={() => run(['status'])}>
			<Icon icon="mingcute:information-line" width="12" height="12" /> Status
		</button>
		<button
			class="df-btn"
			disabled={busy || !session.fsReady}
			onclick={() => run(['log', '--oneline', '-5'])}
		>
			<Icon icon="mingcute:history-line" width="12" height="12" /> Log
		</button>
		<button class="df-btn" disabled={busy || !session.fsReady} onclick={() => run(['add', '.'])}>
			<Icon icon="mingcute:add-line" width="12" height="12" /> Stage
		</button>
		<button class="df-btn" disabled={busy || !session.fsReady} onclick={commit}>
			<Icon icon="mingcute:git-commit-line" width="12" height="12" /> Commit
		</button>
		<button
			class="df-btn"
			disabled={busy || !session.fsReady}
			onclick={() => run(['pull', '--rebase'])}
		>
			<Icon icon="mingcute:down-line" width="12" height="12" /> Pull
		</button>
		<button class="df-btn" disabled={busy || !session.fsReady} onclick={() => run(['push'])}>
			<Icon icon="mingcute:up-line" width="12" height="12" /> Push
		</button>
	</div>

	<p class="df-git-note">
		Commands echo into the Output terminal at the bottom. Git runs inside BrowserPod; the
		Dragon86/9p sync layer mirrors files into that shell.
	</p>
</div>

<style>
	.df-git-view {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
		padding: 8px;
		font-family: var(--font-body);
	}
	.df-git-card {
		border-color: var(--border-color-light);
		padding: 8px 10px;
	}
	.df-git-label {
		margin-bottom: 5px;
		font-size: 9px;
		color: var(--text-dim);
	}
	.df-git-repo {
		overflow: hidden;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-primary);
	}
	.df-git-branch {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 11px;
		color: var(--text-secondary);
	}
	.df-git-empty {
		font-size: 11px;
		color: var(--text-dim);
	}
	.df-git-list {
		display: grid;
		gap: 4px;
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}
	.df-git-list li {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		color: var(--theme-gold, #ffd479);
	}
	.df-git-list li span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.df-git-message {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.df-git-message .df-input {
		width: 100%;
		font-size: 11px;
	}
	.df-git-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 5px;
	}
	.df-git-actions .df-btn {
		padding: 6px 7px;
		font-size: 0.62rem;
	}
	.df-git-note {
		margin: 0;
		font-size: 10px;
		line-height: 1.45;
		color: var(--text-dim);
	}
</style>
