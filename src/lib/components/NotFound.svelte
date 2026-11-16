<script lang="ts">
	/**
	 * The one "not here" page: an unknown address, a note or project that no
	 * longer exists. The empty-state look, with a way on: Home and Search.
	 */
	import { FileQuestion, Home, Search } from 'lucide-svelte';
	import { triggerSearch } from '$lib/stores/snackbar';

	interface Props {
		title?: string;
		detail?: string;
	}

	let { title = 'Page not found', detail = 'This address doesn’t lead anywhere in Kurumi. It may be an old link.' }: Props = $props();
</script>

<div class="k-empty not-found" role="status">
	<FileQuestion aria-hidden="true" />
	<h1 class="k-empty-title">{title}</h1>
	<p>{detail}</p>
	<div class="mt-3 flex flex-wrap justify-center gap-2">
		<a href="/" class="k-btn k-btn-primary no-underline"><Home class="h-4 w-4" /> Home</a>
		<button type="button" class="k-btn" onclick={() => triggerSearch.set(true)}><Search class="h-4 w-4" /> Search</button>
	</div>
</div>

<style>
	.not-found {
		min-height: 60%;
		justify-content: center;
	}

	.not-found h1 {
		margin: 0;
	}
</style>
