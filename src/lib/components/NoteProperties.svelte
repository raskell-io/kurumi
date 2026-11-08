<script lang="ts">
	/**
	 * Under a note's title, when the note is a row of a database (its folder
	 * has a database view): the database's properties, editable, and a link
	 * back to the database.
	 */
	import {
		databaseViews,
		memoryObjects,
		setMemoryCustomProp,
		setDatabaseProperties,
		type MemoryObject,
		type PropertyDefinition
	} from '$lib/db';
	import { optionsOf, PROPERTY_TYPES } from '$lib/database';
	import PropertyValue from './PropertyValue.svelte';
	import { Database, ArrowUpRight } from 'lucide-svelte';

	let { memory }: { memory: MemoryObject } = $props();

	let view = $derived(
		$databaseViews.filter((v) => v.folderId === memory.folderId).sort((a, b) => a.createdAt - b.createdAt)[0]
	);
	let properties = $derived(view?.properties ?? []);
	let siblings = $derived(view ? $memoryObjects.filter((m) => m.folderId === view.folderId) : []);

	function addOption(prop: PropertyDefinition, option: string) {
		if (!view) return;
		const options = optionsOf(prop, siblings);
		if (options.includes(option)) return;
		setDatabaseProperties(
			view.folderId,
			properties.map((p) => (p.key === prop.key ? { ...p, options: [...options, option] } : p))
		);
	}
</script>

{#if view}
	<section class="note-props" aria-label="Properties">
		{#each properties as prop (prop.key)}
			<div class="note-prop">
				<span class="note-prop-label" title={PROPERTY_TYPES.find((t) => t.type === prop.type)?.label}>{prop.label}</span>
				<div class="min-w-0 flex-1">
					<PropertyValue
						{prop}
						value={memory.customProps?.[prop.key]}
						options={optionsOf(prop, siblings)}
						onChange={(v) => setMemoryCustomProp(memory.id, prop.key, v)}
						onAddOption={(o) => addOption(prop, o)}
					/>
				</div>
			</div>
		{/each}
		<a href="/database/{view.id}" class="note-prop-db">
			<Database class="h-3.5 w-3.5" />
			{properties.length ? 'Open the database' : 'Add properties in the database'}
			<ArrowUpRight class="h-3 w-3" />
		</a>
	</section>
{/if}

<style>
	.note-props {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		margin: -0.25rem 0 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.8125rem;
	}

	.note-prop {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.note-prop-label {
		width: 8.5rem;
		flex-shrink: 0;
		padding: 0.25rem 0;
		color: var(--color-text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.note-prop-db {
		display: inline-flex;
		align-self: flex-start;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		text-decoration: none;
	}

	.note-prop-db:hover {
		color: var(--color-accent);
	}
</style>
