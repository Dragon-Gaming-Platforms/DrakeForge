<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '@iconify/svelte';
	import { zenState, toggleZen } from '$lib/stores/zen.svelte';

	// One toggle, two homes: the IDE rail and the agents terminal pane. Behaviour, icon-swap,
	// tooltip and aria live here; each host passes its own classes since a rail icon and a glass
	// pill over a terminal are legitimately different looks.
	let {
		baseClass = '',
		activeClass = '',
		idleClass = '',
		size = 18,
		onToggle
	}: {
		baseClass?: string;
		activeClass?: string;
		idleClass?: string;
		size?: number;
		onToggle?: () => void;
	} = $props();

	async function handle() {
		toggleZen();
		onToggle?.();
		// Zen changes the available width; let the DOM settle, then refit anything sized off it
		// (pod terminals, resizable splits) via the same resize event the IDE splitters use.
		await tick();
		window.dispatchEvent(new Event('resize'));
	}
</script>

<button
	type="button"
	onclick={handle}
	class="{baseClass} {zenState.on ? activeClass : idleClass}"
	aria-pressed={zenState.on}
	title={zenState.on ? 'Exit zen mode' : 'Zen mode'}
>
	<Icon
		icon={zenState.on ? 'mingcute:fullscreen-exit-line' : 'mingcute:fullscreen-line'}
		width={size}
		height={size}
	/>
</button>
