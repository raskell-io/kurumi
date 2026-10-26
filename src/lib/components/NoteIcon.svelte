<script lang="ts">
	import { NotebookText } from 'lucide-svelte';

	// A note's page icon (emoji or uploaded image), falling back to the
	// generic note glyph. `class` sets the box size; emoji take the
	// surrounding font size unless `class` also sets one (e.g. text-5xl).
	let {
		icon,
		class: className = 'h-4 w-4'
	}: { icon: string | null | undefined; class?: string } = $props();
</script>

{#if icon?.startsWith('data:')}
	<img src={icon} alt="" class="{className} shrink-0 rounded-[3px] object-cover" />
{:else if icon}
	<span class="note-emoji {className} shrink-0" aria-hidden="true">{icon}</span>
{:else}
	<NotebookText class="{className} shrink-0" />
{/if}

<style>
	.note-emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
	}
</style>
