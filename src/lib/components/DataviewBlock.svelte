<script lang="ts">
	import { search, parseSearchQuery, filterMemories, hasAnyFilter } from '$lib/search';
	import { memoryObjects, getFolder, todayIso, type MemoryObject } from '$lib/db';
	import { FileText, Mic, Users, Search } from 'lucide-svelte';

	interface Props {
		/** Raw content inside the ```kurumi code block. Lines are parsed
		 *  as: first line = the filter query, subsequent key:value lines
		 *  configure the view (view, group, limit, sort). */
		source: string;
	}

	let { source }: Props = $props();

	type ViewType = 'list' | 'table' | 'board';

	interface Config {
		query: string;
		view: ViewType;
		group: string | null;
		limit: number;
		sort: 'updated' | 'created' | 'title';
	}

	function parseConfig(raw: string): Config {
		const lines = raw.trim().split('\n');
		const config: Config = {
			query: '',
			view: 'list',
			group: null,
			limit: 50,
			sort: 'updated'
		};

		const queryParts: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const colonIdx = trimmed.indexOf(':');
			if (colonIdx > 0) {
				const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
				const value = trimmed.slice(colonIdx + 1).trim();
				switch (key) {
					case 'view':
						if (['list', 'table', 'board'].includes(value.toLowerCase())) {
							config.view = value.toLowerCase() as ViewType;
						}
						break;
					case 'group':
						config.group = value;
						break;
					case 'limit':
						config.limit = Math.max(1, Math.min(200, parseInt(value, 10) || 50));
						break;
					case 'sort':
						if (['updated', 'created', 'title'].includes(value.toLowerCase())) {
							config.sort = value.toLowerCase() as Config['sort'];
						}
						break;
					default:
						// Not a view config key — treat as part of the query
						queryParts.push(trimmed);
				}
			} else {
				queryParts.push(trimmed);
			}
		}
		config.query = queryParts.join(' ').trim();
		return config;
	}

	let config = $derived(parseConfig(source));

	let results = $derived.by(() => {
		// Re-run whenever memoryObjects change
		void $memoryObjects;
		if (!config.query) return $memoryObjects.slice(0, config.limit);
		const hits = search(config.query);
		const ids = hits.map((h) => h.id);
		const byId = new Map($memoryObjects.map((m) => [m.id, m]));
		return ids
			.map((id) => byId.get(id))
			.filter((m): m is MemoryObject => !!m)
			.slice(0, config.limit);
	});

	let sorted = $derived.by(() => {
		const items = [...results];
		switch (config.sort) {
			case 'title':
				items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
				break;
			case 'created':
				items.sort((a, b) => b.createdAt - a.createdAt);
				break;
			case 'updated':
			default:
				items.sort((a, b) => b.updatedAt - a.updatedAt);
		}
		return items;
	});

	// Board grouping
	type GroupedBoard = Map<string, MemoryObject[]>;
	let boardGroups = $derived.by<GroupedBoard>(() => {
		if (config.view !== 'board' || !config.group) return new Map();
		const groups = new Map<string, MemoryObject[]>();
		const field = config.group.toLowerCase();
		for (const memory of sorted) {
			let keys: string[] = [];
			if (field === 'type') keys = [memory.type];
			else if (field === 'folder') {
				const folder = memory.folderId ? getFolder(memory.folderId) : null;
				keys = [folder?.name ?? 'Unfiled'];
			} else if (field === 'participant' || field === 'participants') {
				keys = memory.participants.length > 0 ? memory.participants : ['(none)'];
			} else if (field === 'topic' || field === 'topics') {
				keys = memory.topics.length > 0 ? memory.topics : ['(none)'];
			} else if (field === 'status') {
				keys = [memory.processingState];
			} else {
				keys = ['(all)'];
			}
			for (const key of keys) {
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key)!.push(memory);
			}
		}
		return groups;
	});

	function typeIcon(type: string) {
		if (type === 'meeting') return Users;
		if (type === 'voice-memo') return Mic;
		return FileText;
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	function preview(text: string, max = 80): string {
		const clean = text.replace(/\s+/g, ' ').trim();
		return clean.length > max ? clean.slice(0, max) + '...' : clean;
	}
</script>

<div class="dataview" role="region" aria-label="Live query results">
	<div class="dv-header">
		<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
		<code class="dv-query" title={config.query || 'All memories'}>{config.query || 'All memories'}</code>
		<span class="dv-count">{sorted.length} result{sorted.length === 1 ? '' : 's'}</span>
	</div>

	{#if sorted.length === 0}
		<p class="dv-empty">No memories match this query.</p>
	{:else if config.view === 'table'}
		<div class="dv-table-wrap">
			<table class="dv-table">
				<thead>
					<tr>
						<th>Title</th>
						<th>Type</th>
						<th>Updated</th>
						<th>Tags</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as memory (memory.id)}
						<tr>
							<td><a href="/memory/{memory.id}" class="dv-link">{memory.title || 'Untitled'}</a></td>
							<td class="dv-muted capitalize">{memory.type}</td>
							<td class="dv-muted whitespace-nowrap tabular-nums">{formatDate(memory.updatedAt)}</td>
							<td class="dv-muted">{memory.tags.slice(0, 3).map((t) => '#' + t).join(' ')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if config.view === 'board' && config.group}
		<div class="dv-board">
			{#each [...boardGroups.entries()] as [groupName, items] (groupName)}
				<div class="dv-column">
					<div class="dv-column-header">
						<span class="truncate">{groupName}</span>
						<span class="dv-column-count">{items.length}</span>
					</div>
					{#each items as memory (memory.id)}
						<a href="/memory/{memory.id}" class="dv-card">
							<span class="dv-card-title">{memory.title || 'Untitled'}</span>
							{#if memory.summaryShort}
								<span class="dv-card-summary">{preview(memory.summaryShort)}</span>
							{/if}
						</a>
					{/each}
				</div>
			{/each}
		</div>
	{:else}
		<!-- Default: list view -->
		<ul class="dv-list">
			{#each sorted as memory (memory.id)}
				{@const Icon = typeIcon(memory.type)}
				<li>
					<a href="/memory/{memory.id}" class="dv-list-item">
						<Icon class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
						<span class="dv-list-title">{memory.title || 'Untitled'}</span>
						<span class="dv-list-date">{formatDate(memory.updatedAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	/* Rendered inside the editor, so typography is reset explicitly to
	   the UI font rather than inheriting the editor's prose styles. */
	.dataview {
		margin: 1rem 0;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.dv-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.dv-query {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0;
		background: none;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.dv-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}

	.dv-empty {
		margin: 0;
		padding: 1.25rem 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	/* List view */
	.dv-list {
		margin: 0;
		padding: 0.25rem;
		list-style: none;
	}

	.dv-list li {
		margin: 0;
		padding: 0;
	}

	.dv-list-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border-radius: var(--radius-md);
		color: var(--color-text);
		text-decoration: none;
	}

	.dv-list-item:hover {
		background: var(--color-hover);
	}

	.dv-list-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dv-list-date {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}

	/* Table view */
	.dv-table-wrap {
		overflow-x: auto;
	}

	.dv-table {
		width: 100%;
		margin: 0;
		border-collapse: collapse;
	}

	.dv-table th {
		padding: 0.375rem 0.75rem;
		border: none;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		text-align: left;
		white-space: nowrap;
	}

	.dv-table td {
		padding: 0.375rem 0.75rem;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.dv-table tbody tr:last-child td {
		border-bottom: none;
	}

	.dv-table tbody tr:hover td {
		background: var(--color-hover);
	}

	.dv-link {
		font-weight: 500;
		color: var(--color-text);
		text-decoration: none;
	}

	.dv-link:hover {
		text-decoration: underline;
		text-decoration-color: var(--color-text-faint);
		text-underline-offset: 2px;
	}

	.dv-muted {
		color: var(--color-text-muted);
	}

	/* Board view */
	.dv-board {
		display: flex;
		gap: 0.5rem;
		min-height: 10rem;
		padding: 0.5rem;
		overflow-x: auto;
	}

	.dv-column {
		display: flex;
		flex: 0 0 13.5rem;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.375rem;
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
	}

	.dv-column-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.125rem 0.25rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.dv-column-count {
		flex-shrink: 0;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}

	.dv-card {
		display: block;
		padding: 0.4375rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		text-decoration: none;
	}

	.dv-card:hover {
		border-color: color-mix(in srgb, var(--color-text) 18%, var(--color-border));
	}

	.dv-card-title {
		display: block;
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.3;
		color: var(--color-text);
	}

	.dv-card-summary {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}
</style>
