<script lang="ts">
	import { memoryObjects, getAllPeople, getAllTags } from '$lib/db';
	import type { MemoryObject } from '$lib/db/types';
	import { goto } from '$app/navigation';
	import {
		Clock,
		FileText,
		Mic,
		Users,
		Filter,
		X,
		ChevronDown
	} from 'lucide-svelte';

	// Filters
	let typeFilter = $state<string | null>(null);
	let personFilter = $state<string | null>(null);
	let tagFilter = $state<string | null>(null);
	let showFilters = $state(false);

	let people = $derived(getAllPeople());
	let tags = $derived(getAllTags());

	// Filter and group memories by day
	let grouped = $derived.by(() => {
		let filtered = $memoryObjects.filter((m) => !m.deletedAt);

		if (typeFilter) filtered = filtered.filter((m) => m.type === typeFilter);
		if (personFilter) filtered = filtered.filter((m) => m.participants?.includes(personFilter!));
		if (tagFilter) filtered = filtered.filter((m) => m.tags?.includes(tagFilter!));

		filtered.sort((a, b) => b.createdAt - a.createdAt);

		const groups: Array<{ date: string; label: string; items: MemoryObject[] }> = [];
		let currentDate = '';

		for (const m of filtered) {
			const d = new Date(m.createdAt);
			const iso = d.toISOString().slice(0, 10);
			if (iso !== currentDate) {
				currentDate = iso;
				groups.push({
					date: iso,
					label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
					items: []
				});
			}
			groups[groups.length - 1].items.push(m);
		}
		return groups;
	});

	let activeFilters = $derived(
		[typeFilter, personFilter, tagFilter].filter(Boolean).length
	);

	function clearFilters() {
		typeFilter = null;
		personFilter = null;
		tagFilter = null;
	}

	function typeIcon(type: string) {
		switch (type) {
			case 'meeting': return Users;
			case 'voice-memo': return Mic;
			default: return FileText;
		}
	}

	function typeColor(type: string): string {
		switch (type) {
			case 'meeting': return '#34d399';
			case 'voice-memo': return '#a78bfa';
			default: return 'var(--color-accent)';
		}
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}
</script>

<div class="tl-page">
	<header class="tl-header">
		<div class="tl-title">
			<Clock class="h-5 w-5" />
			<h1>Timeline</h1>
		</div>
		<div class="tl-controls">
			{#if activeFilters > 0}
				<button class="clear-btn" onclick={clearFilters}>
					<X class="h-3 w-3" /> Clear
				</button>
			{/if}
			<button class="filter-toggle" onclick={() => (showFilters = !showFilters)}>
				<Filter class="h-4 w-4" />
				{#if activeFilters > 0}
					<span class="filter-badge">{activeFilters}</span>
				{/if}
			</button>
		</div>
	</header>

	{#if showFilters}
		<div class="tl-filters">
			<div class="filter-group">
				<label class="filter-label" for="tl-type-filter">Type</label>
				<select id="tl-type-filter" class="filter-select" bind:value={typeFilter}>
					<option value={null}>All types</option>
					<option value="note">Notes</option>
					<option value="voice-memo">Voice memos</option>
					<option value="meeting">Meetings</option>
				</select>
			</div>
			<div class="filter-group">
				<label class="filter-label" for="tl-person-filter">Person</label>
				<select id="tl-person-filter" class="filter-select" bind:value={personFilter}>
					<option value={null}>All people</option>
					{#each people.slice(0, 30) as p}
						<option value={p.name}>{p.name} ({p.count})</option>
					{/each}
				</select>
			</div>
			<div class="filter-group">
				<label class="filter-label" for="tl-tag-filter">Tag</label>
				<select id="tl-tag-filter" class="filter-select" bind:value={tagFilter}>
					<option value={null}>All tags</option>
					{#each tags.slice(0, 30) as t}
						<option value={t.tag}>#{t.tag} ({t.count})</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}

	{#if grouped.length === 0}
		<div class="tl-empty">
			<Clock class="h-10 w-10 opacity-20" />
			<p>No memories found{activeFilters > 0 ? ' with these filters' : ''}.</p>
		</div>
	{:else}
		<div class="tl-track">
			{#each grouped as group}
				<div class="tl-day">
					<div class="tl-day-label">{group.label}</div>
					{#each group.items as m}
						{@const Icon = typeIcon(m.type)}
						<button class="tl-item" onclick={() => goto(`/memory/${m.id}`)}>
							<div class="tl-dot" style="background: {typeColor(m.type)}"></div>
							<div class="tl-line"></div>
							<div class="tl-card">
								<div class="tl-card-header">
									<Icon class="h-3.5 w-3.5" style="color: {typeColor(m.type)}" />
									<span class="tl-card-title">{m.title || 'Untitled'}</span>
									<span class="tl-card-time">{formatTime(m.createdAt)}</span>
								</div>
								{#if m.summaryShort}
									<p class="tl-card-summary">{m.summaryShort}</p>
								{:else if m.bodyMarkdown}
									<p class="tl-card-summary">{m.bodyMarkdown.slice(0, 120)}{m.bodyMarkdown.length > 120 ? '...' : ''}</p>
								{/if}
								{#if (m.tags?.length ?? 0) > 0 || (m.participants?.length ?? 0) > 0}
									<div class="tl-card-meta">
										{#each (m.participants ?? []).slice(0, 3) as p}
											<span class="meta-badge person">@{p}</span>
										{/each}
										{#each (m.tags ?? []).slice(0, 3) as t}
											<span class="meta-badge tag">#{t}</span>
										{/each}
									</div>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tl-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.tl-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.tl-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.tl-title h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.tl-controls {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.filter-toggle {
		position: relative;
		padding: 0.375rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.filter-toggle:hover { color: var(--color-text); }

	.filter-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		background: var(--color-accent);
		color: white;
		font-size: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.clear-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: 0.25rem;
		background: none;
		color: var(--color-accent);
		font-size: 0.6875rem;
		cursor: pointer;
	}

	.tl-filters {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.filter-group {
		flex: 1;
		min-width: 120px;
	}

	.filter-label {
		display: block;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 0.25rem;
	}

	.filter-select {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.75rem;
	}

	.tl-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.tl-track {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.tl-day-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
		padding-left: 1.5rem;
	}

	.tl-item {
		display: flex;
		align-items: stretch;
		gap: 0;
		position: relative;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
	}

	.tl-dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 0.75rem;
		z-index: 1;
	}

	.tl-line {
		position: absolute;
		left: 0.25rem;
		top: 1.375rem;
		bottom: -0.75rem;
		width: 2px;
		background: var(--color-border);
	}

	.tl-item:last-child .tl-line {
		display: none;
	}

	.tl-card {
		flex: 1;
		margin-left: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		transition: border-color 0.15s;
		margin-bottom: 0.375rem;
	}

	.tl-item:hover .tl-card {
		border-color: var(--color-accent);
	}

	.tl-card-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tl-card-title {
		flex: 1;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tl-card-time {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.tl-card-summary {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.tl-card-meta {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.375rem;
		flex-wrap: wrap;
	}

	.meta-badge {
		font-size: 0.5625rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
	}

	.meta-badge.person {
		background: rgba(166, 227, 161, 0.15);
		color: #a6e3a1;
	}

	.meta-badge.tag {
		background: rgba(250, 179, 135, 0.15);
		color: #fab387;
	}
</style>
