<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { todayIso } from '$lib/db';

	// Redirect /daily -> /daily/<today> so the sidebar "Today" link stays
	// at a stable URL.
	onMount(() => {
		goto(`/daily/${todayIso()}`, { replaceState: true });
	});
</script>

<p class="p-4 text-sm text-[var(--color-text-muted)]">Loading today's note…</p>
