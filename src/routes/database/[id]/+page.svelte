<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		getDatabaseView,
		getMemoryObjectsInFolder,
		getFolder,
		setMemoryCustomProp,
		getMemoryCustomProp,
		updateDatabaseView,
		deleteDatabaseView,
		databaseViews,
		memoryObjects,
		type MemoryObject,
		type DatabaseView,
		type PropertyDefinition,
		type DatabaseColumn
	} from '$lib/db';
	import { search, filterMemories, parseSearchQuery, hasAnyFilter } from '$lib/search';
	import {
		Table,
		LayoutGrid,
		Calendar,
		Settings,
		Trash2,
		Plus,
		ChevronDown,
		ArrowUp,
		ArrowDown
	} from 'lucide-svelte';

	let viewId = $derived($page.params.id ?? '');
	let view = $derived.by(() => {
		void $databaseViews; // subscribe
		void $memoryObjects; // re-derive on memory changes
		return getDatabaseView(viewId);
	});
	let folder = $derived(view ? getFolder(view.folderId) : null);

	// Get memories in this folder, optionally further filtered
	let memories = $derived.by(() => {
		if (!view) return [];
		void $memoryObjects;
		let items = getMemoryObjectsInFolder(view.folderId);
		if (view.filterQuery) {
			const parsed = parseSearchQuery(view.filterQuery);
			if (hasAnyFilter(parsed.filters)) {
				items = filterMemories(items, parsed.filters);
			}
		}
		return sortMemories(items, view.sortField, view.sortDirection);
	});

	function sortMemories(
		items: MemoryObject[],
		field: string | null,
		direction: 'asc' | 'desc'
	): MemoryObject[] {
		if (!field) return items;
		const sorted = [...items];
		const dir = direction === 'asc' ? 1 : -1;
		sorted.sort((a, b) => {
			const av = getFieldValue(a, field);
			const bv = getFieldValue(b, field);
			if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
			if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
			return 0;
		});
		return sorted;
	}

	function getFieldValue(memory: MemoryObject, field: string): unknown {
		if (field.startsWith('prop:')) {
			return memory.customProps?.[field.slice(5)] ?? '';
		}
		switch (field) {
			case 'title':
				return memory.title || 'Untitled';
			case 'type':
				return memory.type;
			case 'createdAt':
				return memory.createdAt;
			case 'updatedAt':
				return memory.updatedAt;
			case 'tags':
				return memory.tags.join(', ');
			case 'participants':
				return memory.participants.join(', ');
			case 'topics':
				return memory.topics.join(', ');
			case 'projects':
				return memory.projects.join(', ');
			case 'processingState':
				return memory.processingState;
			default:
				return '';
		}
	}

	function formatFieldValue(memory: MemoryObject, col: DatabaseColumn): string {
		const value = getFieldValue(memory, col.field);
		if (col.field === 'createdAt' || col.field === 'updatedAt') {
			return new Date(value as number).toLocaleDateString();
		}
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		if (value == null || value === '') return '—';
		return String(value);
	}

	function getColumnLabel(col: DatabaseColumn): string {
		if (col.field.startsWith('prop:')) {
			const propKey = col.field.slice(5);
			const def = view?.properties.find((p) => p.key === propKey);
			return def?.label ?? propKey;
		}
		const builtInLabels: Record<string, string> = {
			title: 'Title',
			type: 'Type',
			createdAt: 'Created',
			updatedAt: 'Updated',
			tags: 'Tags',
			participants: 'Participants',
			topics: 'Topics',
			projects: 'Projects',
			processingState: 'Status'
		};
		return builtInLabels[col.field] ?? col.field;
	}

	function toggleSort(field: string) {
		if (!view) return;
		const newDirection =
			view.sortField === field && view.sortDirection === 'asc' ? 'desc' : 'asc';
		updateDatabaseView(view.id, { sortField: field, sortDirection: newDirection });
	}

	// Inline editing for custom props
	let editingCell = $state<{ memoryId: string; field: string } | null>(null);
	let editValue = $state('');

	function startEditCell(memoryId: string, field: string, currentValue: string) {
		editingCell = { memoryId, field };
		editValue = currentValue;
	}

	function saveCell() {
		if (!editingCell) return;
		if (editingCell.field.startsWith('prop:')) {
			const propKey = editingCell.field.slice(5);
			const def = view?.properties.find((p) => p.key === propKey);
			let typedValue: unknown = editValue;
			if (def?.type === 'number') typedValue = parseFloat(editValue) || 0;
			else if (def?.type === 'checkbox') typedValue = editValue === 'true' || editValue === '1';
			setMemoryCustomProp(editingCell.memoryId, propKey, typedValue);
		}
		editingCell = null;
		editValue = '';
	}

	function handleCellKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveCell();
		} else if (e.key === 'Escape') {
			editingCell = null;
		}
	}

	function handleDelete() {
		if (!view) return;
		if (confirm(`Delete database view "${view.name}"?`)) {
			deleteDatabaseView(view.id);
			goto('/');
		}
	}

	let visibleColumns = $derived(
		(view?.columns ?? []).filter((c) => c.visible)
	);

	// Board grouping
	let boardGroups = $derived.by(() => {
		if (!view || view.viewType !== 'board' || !view.groupField) return new Map<string, MemoryObject[]>();
		const groups = new Map<string, MemoryObject[]>();
		for (const memory of memories) {
			const value = String(getFieldValue(memory, view.groupField) || '(none)');
			if (!groups.has(value)) groups.set(value, []);
			groups.get(value)!.push(memory);
		}
		return groups;
	});
</script>

<svelte:head>
	<title>{view?.name || 'Database'} - Kurumi</title>
</svelte:head>

{#if view}
	<main class="db-page">
		<header class="db-header">
			<div>
				<h1 class="db-title">{view.name}</h1>
				{#if folder}
					<a href="/read/folder/{folder.id}" class="db-folder">{folder.name}</a>
				{/if}
			</div>
			<div class="db-actions">
				<span class="db-count">{memories.length} row{memories.length === 1 ? '' : 's'}</span>
				<button class="icon-btn danger" onclick={handleDelete} title="Delete view">
					<Trash2 class="h-4 w-4" />
				</button>
			</div>
		</header>

		<!-- View switcher -->
		<div class="view-tabs">
			<button
				class="vtab"
				class:active={view.viewType === 'table'}
				onclick={() => updateDatabaseView(view.id, { viewType: 'table' })}
			>
				<Table class="h-3.5 w-3.5" />
				Table
			</button>
			<button
				class="vtab"
				class:active={view.viewType === 'board'}
				onclick={() => updateDatabaseView(view.id, { viewType: 'board' })}
			>
				<LayoutGrid class="h-3.5 w-3.5" />
				Board
			</button>
		</div>

		{#if view.viewType === 'table'}
			<div class="table-wrap">
				<table class="db-table">
					<thead>
						<tr>
							{#each visibleColumns as col (col.field)}
								<th>
									<button class="th-btn" onclick={() => toggleSort(col.field)}>
										{getColumnLabel(col)}
										{#if view.sortField === col.field}
											{#if view.sortDirection === 'asc'}
												<ArrowUp class="h-3 w-3" />
											{:else}
												<ArrowDown class="h-3 w-3" />
											{/if}
										{/if}
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each memories as memory (memory.id)}
							<tr>
								{#each visibleColumns as col (col.field)}
									<td>
										{#if col.field === 'title'}
											<a href="/memory/{memory.id}" class="title-link">
												{memory.title || 'Untitled'}
											</a>
										{:else if col.field.startsWith('prop:') && editingCell?.memoryId === memory.id && editingCell?.field === col.field}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												type="text"
												bind:value={editValue}
												onkeydown={handleCellKeydown}
												onblur={saveCell}
												class="cell-input"
												autofocus
											/>
										{:else if col.field.startsWith('prop:')}
											<button
												class="cell-btn"
												onclick={() =>
													startEditCell(
														memory.id,
														col.field,
														String(getFieldValue(memory, col.field) || '')
													)}
											>
												{formatFieldValue(memory, col) || '—'}
											</button>
										{:else}
											{formatFieldValue(memory, col)}
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if view.viewType === 'board' && view.groupField}
			<div class="board">
				{#each [...boardGroups.entries()] as [groupName, items] (groupName)}
					<div class="board-col">
						<div class="board-col-header">
							{groupName}
							<span class="board-col-count">{items.length}</span>
						</div>
						{#each items as memory (memory.id)}
							<a href="/memory/{memory.id}" class="board-card">
								<span class="board-card-title">{memory.title || 'Untitled'}</span>
							</a>
						{/each}
					</div>
				{/each}
			</div>
		{:else if view.viewType === 'board'}
			<p class="hint">Set a Group field to use board view. Edit the view config to choose one.</p>
		{/if}
	</main>
{:else}
	<div class="not-found">
		<h1>Database view not found</h1>
		<a href="/">Back to home</a>
	</div>
{/if}

<style>
	.db-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.db-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.db-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.db-folder {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.db-folder:hover {
		color: var(--color-accent);
	}

	.db-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.db-count {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.icon-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.icon-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.view-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.vtab {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		margin-bottom: -1px;
	}

	.vtab:hover {
		color: var(--color-text);
	}

	.vtab.active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}

	/* Table view */
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}

	.db-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.db-table th {
		text-align: left;
		padding: 0;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.th-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		text-align: left;
	}

	.th-btn:hover {
		color: var(--color-text);
	}

	.db-table td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.db-table tr:last-child td {
		border-bottom: none;
	}

	.db-table tr:hover td {
		background: var(--color-bg-secondary);
	}

	.title-link {
		color: var(--color-accent);
		text-decoration: none;
		font-weight: 500;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.cell-btn {
		background: transparent;
		border: 1px dashed transparent;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.8125rem;
		text-align: left;
		width: 100%;
	}

	.cell-btn:hover {
		border-color: var(--color-border);
		background: var(--color-bg);
	}

	.cell-input {
		width: 100%;
		padding: 0.125rem 0.375rem;
		border: 1px solid var(--color-accent);
		border-radius: 0.25rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		outline: none;
	}

	/* Board view */
	.board {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 1rem;
		min-height: 18rem;
	}

	.board-col {
		flex: 0 0 240px;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
	}

	.board-col-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		font-size: 0.8125rem;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
	}

	.board-col-count {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		padding: 0.125rem 0.375rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.board-card {
		display: block;
		margin: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		text-decoration: none;
		transition: border-color 0.1s;
	}

	.board-card:hover {
		border-color: var(--color-accent);
	}

	.board-card-title {
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.8125rem;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-align: center;
		padding: 3rem 1rem;
	}

	.not-found {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.not-found h1 {
		font-size: 1.5rem;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.not-found a {
		color: var(--color-accent);
	}
</style>
