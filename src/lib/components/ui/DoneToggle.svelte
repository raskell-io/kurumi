<script lang="ts">
	import { Circle, CircleCheck, CircleDot, CircleSlash } from 'lucide-svelte';

	/**
	 * The one "tick this to-do off" control: an open circle that fills with
	 * a check. Used wherever to-dos are listed (Home, Inbox, To-dos, project
	 * and person pages). Checkboxes inside a note's text stay the editor's.
	 */
	interface Props {
		status?: 'open' | 'in_progress' | 'done' | 'cancelled';
		label: string;
		title?: string;
		onclick: () => void;
		class?: string;
	}
	let { status = 'open', label, title, onclick, class: className = '' }: Props = $props();
</script>

<button
	type="button"
	class="k-done {className}"
	class:k-done-on={status === 'done' || status === 'in_progress'}
	aria-pressed={status === 'done'}
	aria-label={label}
	title={title ?? label}
	{onclick}
>
	{#if status === 'done'}
		<CircleCheck class="h-4 w-4" />
	{:else if status === 'in_progress'}
		<CircleDot class="h-4 w-4" />
	{:else if status === 'cancelled'}
		<CircleSlash class="h-4 w-4" />
	{:else}
		<Circle class="h-4 w-4" />
	{/if}
</button>

<style>
	.k-done-on {
		color: var(--color-accent);
	}
</style>
