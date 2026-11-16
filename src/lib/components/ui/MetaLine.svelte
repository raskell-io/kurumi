<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A line of small facts about a thing ("Ana Ruiz · 5 open to-dos · 3 notes"):
	 * each child is one part, and the separator sits between them with a
	 * space on both sides, wherever the line wraps.
	 */
	interface Props {
		children: Snippet;
		class?: string;
	}
	let { children, class: className = '' }: Props = $props();
</script>

<span class="k-meta {className}">{@render children()}</span>
