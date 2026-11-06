<script lang="ts">
	/**
	 * Inline Agents activity view. The CLI runs in this workspace tab via AgentShell;
	 * no /agents/[tool] page, no target="_blank", no second workspace tab.
	 */
	import { untrack } from 'svelte';
	import Icon from '@iconify/svelte';
	import AgentShell from '$lib/components/agents/AgentShell.svelte';
	import DuplicateTabDialog from '$lib/components/agents/DuplicateTabDialog.svelte';
	import ToolIcon from '$lib/components/ToolIcon.svelte';
	import { AgentSession } from '$lib/agents/session.svelte';
	import { resolveToolId, toolItems, type ToolId } from '$lib/config/tools';
	import type { ShellOptions } from '$lib/ide/shell-options';

	let { initialTool = 'claude' }: { initialTool?: ToolId } = $props();

	const EMBEDDED_AGENT_SHELL: ShellOptions = {
		header: false,
		fileTree: false,
		search: false,
		editor: false,
		terminal: true,
		preview: false,
		tools: false,
		brand: false,
		initialPane: 'terminal',
		leaveGuard: false
	};

	let available = toolItems.filter((item) => !item.disabled);
	let tool = $state<ToolId>(untrack(() => resolveToolId(initialTool)));
	let generation = $state(0);
	let session = $derived(
		new AgentSession(tool, {
			leaveGuard: false,
			onRestart: () => generation++
		})
	);

	function selectTool(id: ToolId): void {
		tool = id;
		generation++;
	}
</script>

<div class="df-agent-view">
	<div class="df-agent-switcher df-card">
		<div class="df-agent-switcher-label df-heading">Agent CLI</div>
		<div class="df-agent-buttons">
			{#each available as item (item.id)}
				<button
					type="button"
					class="df-agent-button"
					class:active={tool === item.id}
					title="Run {item.label} here"
					onclick={() => selectTool(item.id)}
				>
					<span class="df-agent-icon {item.accentClass}">
						<ToolIcon {item} iconSize={15} imgClass="h-4 w-4" alt={item.label} />
					</span>
					<span>{item.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="df-agent-terminal df-card">
		{#if session.lock === 'taken'}
			<DuplicateTabDialog />
		{/if}
		{#key `${tool}:${generation}`}
			<AgentShell {session} shell={EMBEDDED_AGENT_SHELL} />
		{/key}
	</div>

	<p class="df-agent-note">
		<Icon icon="mingcute:information-line" width="12" height="12" />
		One agent CLI at a time, inline in this workspace tab. Provider sign-in may open a temporary OAuth
		tab, but the IDE and its files stay here.
	</p>
</div>

<style>
	.df-agent-view {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		font-family: var(--font-body);
	}
	.df-agent-switcher {
		flex: 0 0 auto;
		padding: 8px;
		border-color: rgba(var(--theme-rgb), 0.25);
	}
	.df-agent-switcher-label {
		margin-bottom: 6px;
		font-size: 10px;
		color: var(--text-dim);
	}
	.df-agent-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.df-agent-button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--border-color-light);
		border-radius: 5px;
		background: var(--bg-card);
		color: var(--text-secondary);
		padding: 4px 7px;
		font-size: 11px;
		cursor: pointer;
		transition: var(--t-fast);
	}
	.df-agent-button:hover,
	.df-agent-button.active {
		border-color: var(--theme-primary);
		background: rgba(var(--theme-rgb), 0.14);
		color: var(--text-primary);
		box-shadow: 0 0 12px rgba(var(--theme-rgb), 0.18);
	}
	.df-agent-icon {
		display: grid;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 4px;
	}
	.df-agent-terminal {
		position: relative;
		min-height: 0;
		flex: 1;
		overflow: hidden;
		border-color: var(--border-color-light);
		background: var(--bg-darkest);
	}
	.df-agent-note {
		display: flex;
		flex: 0 0 auto;
		align-items: flex-start;
		gap: 5px;
		margin: 0;
		font-size: 10px;
		line-height: 1.4;
		color: var(--text-dim);
	}
</style>
