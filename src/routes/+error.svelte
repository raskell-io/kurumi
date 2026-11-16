<script lang="ts">
	import { page } from '$app/stores';
	import NotFound from '$lib/components/NotFound.svelte';
</script>

<svelte:head>
	<title>{$page.status === 404 ? 'Not found' : 'Something went wrong'} - Kurumi</title>
</svelte:head>

{#if $page.status === 404}
	<NotFound />
{:else}
	<NotFound
		title="Something went wrong"
		detail={$page.error?.message ? `This page couldn’t be shown: ${$page.error.message}` : 'This page couldn’t be shown.'}
	/>
{/if}
