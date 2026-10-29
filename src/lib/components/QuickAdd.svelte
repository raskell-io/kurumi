<script lang="ts">
	import { Plus } from 'lucide-svelte';

	// A one-line "type and press Enter to add" input.
	let {
		placeholder,
		onAdd,
		label = placeholder
	}: { placeholder: string; onAdd: (text: string) => void; label?: string } = $props();

	let text = $state('');

	function submit() {
		const value = text.trim();
		if (!value) return;
		onAdd(value);
		text = '';
	}
</script>

<form
	class="quick-add"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<Plus class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
	<input bind:value={text} {placeholder} aria-label={label} class="quick-add-input" />
	{#if text.trim()}
		<button type="submit" class="k-btn k-btn-sm">Add</button>
	{/if}
</form>

<style>
	.quick-add {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.25rem;
		padding: 0 0.625rem;
		border-radius: var(--radius-md);
	}

	.quick-add:focus-within {
		background: var(--color-hover);
	}

	.quick-add-input,
	.quick-add-input:focus,
	.quick-add-input:focus-visible {
		min-width: 0;
		flex: 1;
		height: 2.25rem;
		border: none !important;
		background: transparent;
		color: var(--color-text);
		font-size: 0.875rem;
		outline: none !important;
		box-shadow: none !important;
	}

	.quick-add-input::placeholder {
		color: var(--color-text-faint);
	}
</style>
