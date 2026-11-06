<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { appHref } from '$lib/utils/paths';

	onMount(() =>
		window.location.replace(appHref(`/?agent=${encodeURIComponent($page.params.tool ?? 'claude')}`))
	);
</script>

<div class="df-heading df-radial-bg flex h-full w-full items-center justify-center text-sm">
	Opening workspace…
</div>
