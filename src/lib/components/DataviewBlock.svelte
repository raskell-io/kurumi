<script lang="ts">
	import { search, parseSearchQuery, filterMemories, hasAnyFilter } from '$lib/search';
	import { memoryObjects, getFolder, todayIso, type MemoryObject } from '$lib/db';
	import { FileText, Calendar, Mic, Users, Folder } from 'lucide-svelte';

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
		<span class="dv-badge">{sorted.length} result{sorted.length === 1 ? '' : 's'}</span>
		<code class="dv-query">{config.query || '(all memories)'}</code>
	</div>

	{#if config.view === 'table'}
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
						<td class="dv-type">{memory.type}</td>
						<td class="dv-date">{formatDate(memory.updatedAt)}</td>
						<td class="dv-tags">{memory.tags.slice(0, 3).map((t) => '#' + t).join(' ')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if config.view === 'board' && config.group}
		<div class="dv-board">
			{#each [...boardGroups.entries()] as [groupName, items] (groupName)}
				<div class="dv-column">
					<div class="dv-column-header">
						{groupName}
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
						<Icon class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
						<span class="dv-list-title">{memory.title || 'Untitled'}</span>
						<span class="dv-list-date">{formatDate(memory.updatedAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.dataview {
		margin: 1rem 0;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
		font-size: 0.8125rem;
	}

	.dv-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.dv-badge {
		padding: 0.125rem 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 500;
	}

	.dv-query {
		color: var(--color-text-muted);
		font-size: 0.6875rem;
	}

	/* List view */
	.dv-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.dv-list-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4375rem 0.75rem;
		text-decoration: none;
		color: var(--color-text);
		transition: background 0.1s;
	}

	.dv-list-item:hover {
		background: var(--color-bg-secondary);
	}

	.dv-list-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dv-list-date {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-size: 0.6875rem;
	}

	/* Table view */
	.dv-table {
		width: 100%;
		border-collapse: collapse;
	}

	.dv-table th {
		text-align: left;
		padding: 0.375rem 0.75rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		font-weight: 600;
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.dv-table td {
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.dv-table tr:last-child td {
		border-bottom: none;
	}

	.dv-link {
		color: var(--color-accent);
		text-decoration: none;
	}

	.dv-link:hover {
		text-decoration: underline;
	}

	.dv-type {
		color: var(--color-text-muted);
		text-transform: capitalize;
	}

	.dv-date {
		color: var(--color-text-muted);
	}

	.dv-tags {
		color: var(--color-text-muted);
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
	}

	/* Board view */
	.dv-board {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem;
		overflow-x: auto;
		min-height: 12rem;
	}

	.dv-column {
		flex: 0 0 220px;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
	}

	.dv-column-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.625rem;
		font-weight: 600;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
	}

	.dv-column-count {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		padding: 0.125rem 0.375rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.dv-card {
		display: block;
		margin: 0.375rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		text-decoration: none;
		transition: border-color 0.1s;
	}

	.dv-card:hover {
		border-color: var(--color-accent);
	}

	.dv-card-title {
		display: block;
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.75rem;
		line-height: 1.3;
	}

	.dv-card-summary {
		display: block;
		margin-top: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		line-height: 1.3;
	}
</style>
