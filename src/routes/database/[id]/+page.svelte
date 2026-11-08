<script lang="ts">
	// A database as a page; the view itself is DatabaseView (also embedded
	// in notes as a ```database block).
	import { page } from '$app/stores';
	import DatabaseView from '$lib/components/database/DatabaseView.svelte';
</script>

{#key $page.params.id}
	<DatabaseView viewId={$page.params.id ?? ''} />
{/key}
