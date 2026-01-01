<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Kurumi - Read</title>
</svelte:head>

<div class="read-layout">
	{@render children()}
</div>

<style>
	.read-layout {
		min-height: 100%;
		background: var(--color-bg);
		max-width: 100%;
		overflow-x: hidden;
	}
</style>
