<script lang="ts">
	/**
	 * A relation property's value: links to the related notes, and a picker
	 * (the target database's rows, or any note) to add or remove them.
	 */
	import type { MemoryObject, PropertyDefinition } from '$lib/db';
	import Popover from './Popover.svelte';
	import NoteIcon from './NoteIcon.svelte';
	import { Check, Plus } from 'lucide-svelte';

	interface Props {
		prop: PropertyDefinition;
		value: string[];
		candidates: MemoryObject[];
		byId: Map<string, MemoryObject>;
		onChange: (ids: string[]) => void;
		/** Create a row in the target database with this title. */
		onCreate?: (title: string) => string | null;
		readonly?: boolean;
	}

	let { prop, value, candidates, byId, onChange, onCreate, readonly = false }: Props = $props();
	let trigger: HTMLButtonElement | undefined = $state();
	let open = $state(false);
	let query = $state('');

	let matches = $derived(
		candidates
			.filter((m) => (m.title || 'Untitled').toLowerCase().includes(query.trim().toLowerCase()))
			.sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)) || (a.title || '').localeCompare(b.title || ''))
			.slice(0, 30)
	);

	function toggle(id: string) {
		onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
	}

	function create() {
		const id = onCreate?.(query.trim());
		if (id) onChange([...value, id]);
		query = '';
	}

	const focus = (el: HTMLInputElement) => {
		requestAnimationFrame(() => el.focus());
	};
</script>

<div class="rv">
	{#each value as id (id)}
		{@const m = byId.get(id)}
		{#if m}
			<a href="/memory/{m.id}" class="rv-chip" title="Open {m.title || 'Untitled'}">
				<NoteIcon icon={m.icon} class="h-3 w-3 shrink-0" />
				<span class="truncate">{m.title || 'Untitled'}</span>
			</a>
		{/if}
	{/each}
	{#if !readonly}
		<button type="button" class="rv-add" bind:this={trigger} onclick={() => (open = !open)} aria-label="Edit {prop.label}" title="Link notes">
			{#if value.length === 0}<span class="rv-empty">Add</span>{:else}<Plus class="h-3 w-3" />{/if}
		</button>
	{/if}
</div>

{#if open && trigger}
	<Popover anchor={trigger} onClose={() => (open = false)} width="17rem" label="{prop.label}: link notes">
		<input class="k-input !h-8 !text-[0.8125rem]" placeholder="Find a note" bind:value={query} use:focus
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					if (matches[0]) toggle(matches[0].id);
					else if (query.trim() && onCreate) create();
				}
			}}
		/>
		<div class="mt-1 max-h-64 overflow-y-auto">
			{#each matches as m (m.id)}
				<button type="button" class="k-menu-item justify-between" onclick={() => toggle(m.id)}>
					<span class="flex min-w-0 items-center gap-1.5"><NoteIcon icon={m.icon} class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" /><span class="truncate">{m.title || 'Untitled'}</span></span>
					{#if value.includes(m.id)}<Check class="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />{/if}
				</button>
			{/each}
			{#if query.trim() && onCreate && !matches.some((m) => (m.title || '').toLowerCase() === query.trim().toLowerCase())}
				<button type="button" class="k-menu-item" onclick={create}><Plus class="h-3.5 w-3.5" />New “{query.trim()}”</button>
			{/if}
			{#if matches.length === 0 && !query.trim()}
				<p class="k-menu-label">No notes to link yet.</p>
			{/if}
		</div>
	</Popover>
{/if}

<style>
	.rv {
		display: flex;
		min-height: 1.75rem;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.25rem;
	}

	.rv-chip {
		display: inline-flex;
		max-width: 12rem;
		align-items: center;
		gap: 0.25rem;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--color-hover);
		font-size: 0.75rem;
		color: var(--color-text);
		text-decoration: underline;
		text-decoration-color: var(--color-border);
		text-underline-offset: 2px;
	}

	.rv-chip:hover {
		text-decoration-color: var(--color-text-faint);
	}

	.rv-add {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
		font-size: 0.75rem;
	}

	.rv-add:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.rv-empty {
		color: var(--color-text-faint);
	}
</style>
