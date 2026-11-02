<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '@iconify/svelte';
	import ToolIcon from '$lib/components/ToolIcon.svelte';
	import { toolItems } from '$lib/config/tools';

	let available = toolItems.filter((item) => !item.disabled);
	let soon = toolItems.filter((item) => item.disabled);
</script>

<div class="flex h-full flex-col gap-3 overflow-y-auto p-3 text-[12px]">
	<div class="df-agent-intro">
		<Icon icon="mingcute:ai-line" width="16" height="16" />
		<div>
			<strong>BrowserCode Agents</strong>
			<p>Run CLI coding agents in BrowserPod sandboxes, on the DrakeForge workspace.</p>
		</div>
	</div>

	<a class="df-home-link" href={resolve('/agents')} target="_blank" rel="noopener noreferrer">
		<Icon icon="mingcute:external-link-line" width="12" height="12" /> Open Agents home
	</a>

	<div class="df-panel-label">Available</div>
	<div class="flex flex-col gap-1.5">
		{#each available as item (item.id)}
			<a
				class="df-agent-row"
				href={resolve('/agents/[tool]', { tool: item.id })}
				target="_blank"
				rel="noopener noreferrer"
				title="Open {item.label} in a new tab"
			>
				<span class="df-agent-icon {item.accentClass}">
					<ToolIcon {item} iconSize={16} imgClass="h-4 w-4" alt={item.label} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate font-medium text-bc-text">{item.label}</span>
					{#if item.note}<span class="block truncate text-[10px] text-bc-text-muted"
							>{item.note}</span
						>{/if}
				</span>
				<Icon icon="mingcute:external-link-line" width="12" height="12" class="text-bc-icon" />
			</a>
		{/each}
	</div>

	{#if soon.length > 0}
		<div class="df-panel-label">Coming soon</div>
		<div class="flex flex-col gap-1.5">
			{#each soon as item (item.id)}
				<div class="df-agent-row df-agent-disabled" title="{item.label} is not enabled yet">
					<span class="df-agent-icon bg-bc-tint/5 text-bc-icon">
						<ToolIcon {item} iconSize={16} imgClass="h-4 w-4 opacity-50" alt={item.label} />
					</span>
					<span class="min-w-0 flex-1 truncate font-medium text-bc-text-muted">{item.label}</span>
				</div>
			{/each}
		</div>
	{/if}

	<p class="text-[11px] leading-relaxed text-bc-text-muted">
		Agent pages open in a new tab so the running IDE and its BrowserPod session stay alive.
	</p>
</div>

<style>
	.df-agent-intro {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		border: 1px solid rgba(var(--dragon86-rgb), 0.35);
		border-radius: 9px;
		background: rgba(var(--dragon86-rgb), 0.08);
		padding: 9px 10px;
		color: var(--color-bc-azure);
	}
	.df-agent-intro strong {
		display: block;
		font-size: 12px;
		color: var(--color-bc-text);
	}
	.df-agent-intro p {
		margin: 2px 0 0;
		line-height: 1.4;
		color: var(--color-bc-mist);
	}
	.df-home-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--color-bc-border);
		border-radius: 7px;
		background: var(--color-bc-surface);
		padding: 7px 9px;
		color: var(--color-bc-azure);
		text-decoration: none;
	}
	.df-home-link:hover {
		border-color: var(--color-bc-azure);
		box-shadow: 0 0 12px rgba(var(--dragon86-rgb), 0.18);
	}
	.df-panel-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-bc-text-muted);
	}
	.df-agent-row {
		display: flex;
		align-items: center;
		gap: 9px;
		border: 1px solid var(--color-bc-border);
		border-radius: 8px;
		background: var(--color-bc-surface);
		padding: 7px 9px;
		color: var(--color-bc-text);
		text-decoration: none;
		transition: 0.15s ease;
	}
	a.df-agent-row:hover {
		border-color: var(--color-bc-azure);
		box-shadow: 0 0 12px rgba(var(--dragon86-rgb), 0.18);
	}
	.df-agent-disabled {
		opacity: 0.6;
	}
	.df-agent-icon {
		display: grid;
		width: 28px;
		height: 28px;
		flex: 0 0 28px;
		place-items: center;
		border-radius: 7px;
	}
</style>
