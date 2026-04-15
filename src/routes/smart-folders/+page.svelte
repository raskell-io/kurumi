<script lang="ts">
	import {
		savedSearches,
		addSavedSearch,
		deleteSavedSearch,
		memoryObjects,
		getAllTags,
		getAllPeople
	} from '$lib/db';
	import type { MemoryObject } from '$lib/db/types';
	import { goto } from '$app/navigation';
	import {
		FolderSearch,
		Plus,
		Trash2,
		FileText,
		Mic,
		Users,
		ChevronRight,
		X
	} from 'lucide-svelte';

	let showCreate = $state(false);
	let newName = $state('');
	let filterType = $state('');
	let filterTag = $state('');
	let filterPerson = $state('');
	let filterQuery = $state('');

	let tags = $derived(getAllTags());
	let people = $derived(getAllPeople());

	function buildQuery(): string {
		const parts: string[] = [];
		if (filterQuery) parts.push(filterQuery);
		if (filterType) parts.push(`type:${filterType}`);
		if (filterTag) parts.push(`tag:${filterTag}`);
		if (filterPerson) parts.push(`person:${filterPerson}`);
		return parts.join(' ');
	}

	function handleCreate() {
		const name = newName.trim();
		const query = buildQuery();
		if (!name || !query) return;
		addSavedSearch(name, query, undefined);
		showCreate = false;
		newName = '';
		filterType = '';
		filterTag = '';
		filterPerson = '';
		filterQuery = '';
	}

	// Count matches for a saved search query
	function countMatches(query: string): number {
		return filterMemories(query, $memoryObjects).length;
	}

	function filterMemories(query: string, memories: MemoryObject[]): MemoryObject[] {
		let filtered = memories.filter((m) => !m.deletedAt);
		const parts = query.split(/\s+/);
		const textParts: string[] = [];

		for (const part of parts) {
			if (part.startsWith('type:')) {
				const t = part.slice(5);
				filtered = filtered.filter((m) => m.type === t);
			} else if (part.startsWith('tag:')) {
				const t = part.slice(4);
				filtered = filtered.filter((m) => m.tags?.includes(t));
			} else if (part.startsWith('person:')) {
				const p = part.slice(7);
				filtered = filtered.filter((m) => m.participants?.some((pp) => pp.toLowerCase().includes(p.toLowerCase())));
			} else {
				textParts.push(part);
			}
		}

		if (textParts.length > 0) {
			const text = textParts.join(' ').toLowerCase();
			filtered = filtered.filter((m) =>
				(m.title || '').toLowerCase().includes(text) ||
				(m.bodyMarkdown || '').toLowerCase().includes(text)
			);
		}

		return filtered;
	}

	let selectedFolder = $state<string | null>(null);

	let selectedResults = $derived.by(() => {
		if (!selectedFolder) return [];
		const search = $savedSearches.find((s) => s.id === selectedFolder);
		if (!search) return [];
		return filterMemories(search.query, $memoryObjects)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, 50);
	});
</script>

<div class="sf-page">
	<header class="sf-header">
		<div class="sf-title">
			<FolderSearch class="h-5 w-5" />
			<h1>Smart Folders</h1>
		</div>
		<button class="create-btn" onclick={() => (showCreate = !showCreate)}>
			{#if showCreate}
				<X class="h-4 w-4" />
			{:else}
				<Plus class="h-4 w-4" />
			{/if}
		</button>
	</header>

	{#if showCreate}
		<div class="create-form">
			<input
				bind:value={newName}
				placeholder="Folder name..."
				class="sf-input"
			/>
			<input
				bind:value={filterQuery}
				placeholder="Text search (optional)..."
				class="sf-input"
			/>
			<div class="filter-row">
				<select class="sf-select" bind:value={filterType}>
					<option value="">Any type</option>
					<option value="note">Notes</option>
					<option value="voice-memo">Voice memos</option>
					<option value="meeting">Meetings</option>
				</select>
				<select class="sf-select" bind:value={filterTag}>
					<option value="">Any tag</option>
					{#each tags.slice(0, 30) as t}
						<option value={t.tag}>#{t.tag}</option>
					{/each}
				</select>
				<select class="sf-select" bind:value={filterPerson}>
					<option value="">Any person</option>
					{#each people.slice(0, 30) as p}
						<option value={p.name}>@{p.name}</option>
					{/each}
				</select>
			</div>
			{#if buildQuery()}
				<div class="preview-query">
					Query: <code>{buildQuery()}</code>
				</div>
			{/if}
			<button
				class="save-btn"
				disabled={!newName.trim() || !buildQuery()}
				onclick={handleCreate}
			>
				Create smart folder
			</button>
		</div>
	{/if}

	<div class="sf-layout">
		<div class="sf-list">
			{#if $savedSearches.length === 0 && !showCreate}
				<div class="sf-empty">
					<FolderSearch class="h-8 w-8 opacity-20" />
					<p>No smart folders yet.</p>
				</div>
			{/if}
			{#each $savedSearches as search (search.id)}
				<div
					class="sf-item"
					class:active={selectedFolder === search.id}
					role="button"
					tabindex="0"
					onclick={() => (selectedFolder = search.id)}
					onkeydown={(e) => { if (e.key === 'Enter') selectedFolder = search.id; }}
				>
					<div class="sf-item-info">
						<span class="sf-item-name">{search.name}</span>
						<span class="sf-item-query">{search.query}</span>
					</div>
					<span class="sf-item-count">{countMatches(search.query)}</span>
					<button
						class="sf-item-delete"
						onclick={(e) => { e.stopPropagation(); deleteSavedSearch(search.id); if (selectedFolder === search.id) selectedFolder = null; }}
						title="Delete"
					>
						<Trash2 class="h-3 w-3" />
					</button>
				</div>
			{/each}
		</div>

		{#if selectedFolder && selectedResults.length > 0}
			<div class="sf-results">
				{#each selectedResults as m}
					<button class="sf-result" onclick={() => goto(`/memory/${m.id}`)}>
						{#if m.type === 'meeting'}
							<Users class="h-3.5 w-3.5 shrink-0" style="color: #34d399" />
						{:else if m.type === 'voice-memo'}
							<Mic class="h-3.5 w-3.5 shrink-0" style="color: #a78bfa" />
						{:else}
							<FileText class="h-3.5 w-3.5 shrink-0" style="color: var(--color-accent)" />
						{/if}
						<span class="sf-result-title">{m.title || 'Untitled'}</span>
						<ChevronRight class="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
					</button>
				{/each}
			</div>
		{:else if selectedFolder}
			<div class="sf-results sf-no-results">
				<p>No memories match this filter.</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.sf-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.sf-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.sf-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.sf-title h1 { font-size: 1.25rem; font-weight: 700; margin: 0; }

	.create-btn {
		padding: 0.375rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		margin-bottom: 1rem;
		background: var(--color-bg-secondary);
	}

	.sf-input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		outline: none;
	}

	.sf-input:focus { border-color: var(--color-accent); }

	.filter-row {
		display: flex;
		gap: 0.375rem;
	}

	.sf-select {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.75rem;
	}

	.preview-query {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.preview-query code {
		background: var(--color-bg);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	.save-btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 0.375rem;
		background: var(--color-accent);
		color: white;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.save-btn:disabled { opacity: 0.4; }

	.sf-layout {
		display: flex;
		gap: 1rem;
	}

	.sf-list {
		width: 280px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sf-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.sf-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		cursor: pointer;
		text-align: left;
		width: 100%;
	}

	.sf-item:hover { border-color: var(--color-accent); }
	.sf-item.active { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg)); }

	.sf-item-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.sf-item-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sf-item-query {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sf-item-count {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.sf-item-delete {
		padding: 0.25rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.1s;
	}

	.sf-item:hover .sf-item-delete { opacity: 1; }
	.sf-item-delete:hover { color: #ef4444; }

	.sf-results {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sf-no-results {
		align-items: center;
		justify-content: center;
		padding: 2rem;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.sf-result {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		cursor: pointer;
		text-align: left;
		width: 100%;
	}

	.sf-result:hover { border-color: var(--color-accent); }

	.sf-result-title {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.sf-layout { flex-direction: column; }
		.sf-list { width: 100%; }
	}
</style>
