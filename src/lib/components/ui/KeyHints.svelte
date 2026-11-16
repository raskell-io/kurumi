<script lang="ts">
	import { Keyboard } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import Popover from '$lib/components/Popover.svelte';

	/**
	 * A list page's keyboard keys, behind a small button instead of a line
	 * under every title. "?" on the page opens it too.
	 */
	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();
	let open = $state(false);
	let button: HTMLButtonElement | undefined = $state();

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		e.preventDefault();
		open = !open;
	}
</script>

<svelte:window {onkeydown} />

<button
	type="button"
	bind:this={button}
	class="k-icon-btn k-key-hints-btn"
	aria-label="Keyboard shortcuts"
	aria-expanded={open}
	title="Keyboard shortcuts (?)"
	onclick={() => (open = !open)}
>
	<Keyboard class="h-4 w-4" />
</button>

{#if open && button}
	<Popover anchor={button} onClose={() => (open = false)} width="16rem" label="Keyboard shortcuts">
		<p class="k-menu-label">Keyboard shortcuts</p>
		<div class="k-key-hints">{@render children()}</div>
	</Popover>
{/if}
