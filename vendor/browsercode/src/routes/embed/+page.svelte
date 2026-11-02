<script lang="ts">
	import { onMount } from 'svelte';
	import { appHref } from '$lib/utils/paths';

	onMount(() => window.location.replace(appHref('/?mode=embed')));
</script>

<div class="df-heading df-radial-bg flex h-full w-full items-center justify-center text-sm">
	Opening workspace…
</div>
