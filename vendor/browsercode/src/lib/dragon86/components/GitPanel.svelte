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

<div class="flex h-full flex-col gap-3 overflow-y-auto p-3 text-[12px]">
	<div class="df-panel-card">
		<div class="df-panel-label">Repository</div>
		<div class="truncate font-mono text-[11px] text-bc-text">{repoLabel}</div>
		<div class="mt-2 flex items-center gap-1.5 text-bc-mist">
			<Icon icon="mingcute:git-branch-line" width="13" height="13" />
			<span class="font-mono">{branch}</span>
		</div>
	</div>

	<div class="df-panel-card">
		<div class="df-panel-label">Unsaved buffers</div>
		{#if dirtyFiles.length === 0}
			<div class="text-bc-text-muted">No unsaved editor tabs.</div>
		{:else}
			<ul class="mt-1 space-y-1">
				{#each dirtyFiles as file (file)}
					<li class="flex items-center gap-1.5 font-mono text-[11px] text-bc-gold">
						<Icon icon="mingcute:edit-line" width="11" height="11" />
						<span class="truncate">{file}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<label class="df-panel-card flex flex-col gap-1.5">
		<span class="df-panel-label">Commit message</span>
		<input bind:value={message} type="text" placeholder="Update from DrakeForge" class="df-input" />
	</label>

	<div class="grid grid-cols-2 gap-1.5">
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
			<Icon icon="mingcute:add-line" width="12" height="12" /> Stage all
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

	<p class="text-[11px] leading-relaxed text-bc-text-muted">
		Commands are echoed and run in the Output terminal at the bottom. The Dragon86/9p sync layer
		mirrors files; git still runs inside BrowserPod's shell.
	</p>
</div>

<style>
	.df-panel-card {
		border: 1px solid var(--color-bc-border);
		border-radius: 8px;
		background: var(--color-bc-surface);
		padding: 8px 10px;
	}
	.df-panel-label {
		margin-bottom: 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-bc-text-muted);
	}
	.df-input {
		width: 100%;
		border: 1px solid var(--color-bc-border);
		border-radius: 6px;
		background: var(--color-bc-abyss);
		color: var(--color-bc-text);
		padding: 6px 8px;
		font:
			11px ui-monospace,
			monospace;
		outline: none;
	}
	.df-input:focus {
		border-color: var(--color-bc-azure);
		box-shadow: 0 0 10px rgba(var(--dragon86-rgb), 0.25);
	}
	.df-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 1px solid var(--color-bc-border);
		border-radius: 7px;
		background: var(--color-bc-surface);
		color: var(--color-bc-text);
		padding: 6px 8px;
		font-size: 11px;
		font-family: inherit;
		cursor: pointer;
		transition: 0.15s ease;
	}
	.df-btn:hover:not(:disabled) {
		border-color: var(--color-bc-azure);
		color: var(--color-bc-azure);
		box-shadow: 0 0 12px rgba(var(--dragon86-rgb), 0.18);
	}
	.df-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
