<script lang="ts">
	import { resolve } from '$app/paths';
	import { DEFAULT_DRAGON86_URL } from '../bridge/config';

	let {
		mode,
		status,
		detail,
		peer,
		fs,
		setupUrl,
		otherLabel,
		showOpenDragon86 = false
	}: {
		mode: 'connected' | 'standalone';
		status: string;
		detail: string;
		peer: string;
		fs: string;
		setupUrl: string;
		otherLabel: string;
		showOpenDragon86?: boolean;
	} = $props();

	let copied = $state(false);

	async function copySetupUrl() {
		try {
			await navigator.clipboard.writeText(setupUrl);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			copied = false;
		}
	}
</script>

<aside class="mode-panel" aria-label="Dragon86 connection status">
	<div class="header">
		<span
			class="dot"
			class:live={status.toLowerCase().includes('connected') ||
				status.toLowerCase().includes('ready')}
		></span>
		<div>
			<strong>{mode === 'connected' ? 'Dragon86 connected IDE' : 'Standalone 9p IDE'}</strong>
			<div class="status">{status}</div>
		</div>
		<a class="switch" href={mode === 'connected' ? resolve('/standalone') : resolve('/dragon86')}
			>{otherLabel}</a
		>
	</div>

	<p class="detail">{detail}</p>
	<div class="rows">
		<div><span>Bridge</span><span>{peer}</span></div>
		<div><span>Filesystem</span><span>{fs}</span></div>
		{#if mode === 'connected'}
			<div><span>Engine URL</span><code>{setupUrl}</code></div>
		{/if}
	</div>

	<div class="actions">
		{#if mode === 'connected'}
			<button type="button" onclick={copySetupUrl}>{copied ? 'Copied ✓' : 'Copy engine URL'}</button
			>
			{#if showOpenDragon86}
				<a href={DEFAULT_DRAGON86_URL} target="_blank" rel="external noopener noreferrer"
					>Open Dragon86</a
				>
			{/if}
			<a href={resolve('/')}>BrowserCode home</a>
		{:else}
			<span>Persistent ZenFS / IndexedDB</span>
			<a href={resolve('/')}>BrowserCode home</a>
		{/if}
	</div>
</aside>

<style>
	.mode-panel {
		position: absolute;
		top: 14px;
		right: 18px;
		z-index: 45;
		width: min(380px, calc(100% - 36px));
		padding: 12px 14px;
		border: 1px solid var(--color-bc-border);
		border-radius: 14px;
		background: color-mix(in srgb, var(--color-bc-navy) 92%, transparent);
		backdrop-filter: blur(14px);
		box-shadow: 0 14px 44px rgba(0, 0, 0, 0.35);
		color: var(--color-bc-text);
		font:
			12px/1.45 ui-sans-serif,
			system-ui,
			sans-serif;
		pointer-events: auto;
	}
	.header {
		display: flex;
		align-items: flex-start;
		gap: 9px;
	}
	.dot {
		width: 9px;
		height: 9px;
		margin-top: 5px;
		flex: 0 0 9px;
		border-radius: 999px;
		background: #f5a524;
		box-shadow: 0 0 0 3px rgba(245, 165, 36, 0.15);
	}
	.dot.live {
		background: #4ade80;
		box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15);
	}
	.header > div {
		min-width: 0;
		flex: 1;
	}
	strong {
		display: block;
		font-size: 12.5px;
	}
	.status {
		color: var(--color-bc-text-muted);
	}
	.switch,
	.actions a {
		color: var(--color-bc-azure);
		text-decoration: none;
		white-space: nowrap;
	}
	.switch:hover,
	.actions a:hover {
		text-decoration: underline;
	}
	.detail {
		margin: 9px 0;
		color: var(--color-bc-mist);
	}
	.rows {
		display: grid;
		gap: 4px;
	}
	.rows > div {
		display: flex;
		gap: 8px;
		justify-content: space-between;
	}
	.rows span:first-child {
		color: var(--color-bc-text-muted);
	}
	.rows span:last-child,
	code {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	code {
		font:
			10.5px ui-monospace,
			monospace;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-top: 10px;
		padding-top: 9px;
		border-top: 1px solid var(--color-bc-border);
	}
	.actions span {
		color: var(--color-bc-text-muted);
	}
	button {
		padding: 5px 9px;
		border: 1px solid var(--color-bc-border);
		border-radius: 8px;
		background: var(--color-bc-abyss);
		color: var(--color-bc-text);
		cursor: pointer;
		font: inherit;
	}
	button:hover {
		border-color: var(--color-bc-azure);
	}
	@media (max-width: 700px) {
		.mode-panel {
			top: 8px;
			right: 8px;
			width: calc(100% - 16px);
		}
	}
</style>
