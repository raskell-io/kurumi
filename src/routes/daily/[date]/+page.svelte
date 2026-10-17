<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getOrCreateDailyNote, todayIso } from '$lib/db';

	// Resolve the daily note for the requested date (creating it from the
	// Daily Journal template on first visit), then hop to the memory editor
	// so the user lands in a familiar view.
	onMount(() => {
		const raw = $page.params.date ?? todayIso();
		// Guard against malformed dates — fall back to today.
		const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIso();
		const memory = getOrCreateDailyNote(iso);
		goto(`/memory/${memory.id}`, { replaceState: true });
	});
</script>

<div class="k-page">
	<p class="text-sm text-[var(--color-text-faint)]">Opening daily note…</p>
</div>
