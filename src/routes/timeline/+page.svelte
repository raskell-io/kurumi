<script lang="ts">
	import { memoryObjects, getAllPeople, getAllTags, todayIso } from '$lib/db';
	import type { MemoryObject } from '$lib/db/types';
	import { Clock, FileText, Mic, Users, ListFilter, X } from 'lucide-svelte';

	// Filters
	let typeFilter = $state<string | null>(null);
	let personFilter = $state<string | null>(null);
	let tagFilter = $state<string | null>(null);
	let showFilters = $state(false);

	let people = $derived(getAllPeople());
	let tags = $derived(getAllTags());

	// Local-time YYYY-MM-DD (toISOString() is UTC and split days at the
	// wrong hour for anyone outside Greenwich).
	function localIso(dt: Date): string {
		const m = String(dt.getMonth() + 1).padStart(2, '0');
		const d = String(dt.getDate()).padStart(2, '0');
		return `${dt.getFullYear()}-${m}-${d}`;
	}

	function dayLabel(d: Date, iso: string): string {
		const today = todayIso();
		const y = new Date();
		y.setDate(y.getDate() - 1);
		if (iso === today) return 'Today';
		if (iso === localIso(y)) return 'Yesterday';
		return d.toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
		});
	}

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
			const iso = localIso(d);
			if (iso !== currentDate) {
				currentDate = iso;
				groups.push({ date: iso, label: dayLabel(d, iso), items: [] });
			}
			groups[groups.length - 1].items.push(m);
		}
		return groups;
	});

	let totalShown = $derived(grouped.reduce((n, g) => n + g.items.length, 0));

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

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Timeline - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="k-page">
		<header class="k-page-header">
			<div class="min-w-0">
				<h1 class="k-page-title">Timeline</h1>
				<p class="k-page-subtitle">
					{totalShown} {totalShown === 1 ? 'memory' : 'memories'}{activeFilters > 0 ? ' matching filters' : ''}
				</p>
			</div>
			<div class="tl-controls">
				{#if activeFilters > 0}
					<button class="k-btn k-btn-sm k-btn-ghost" onclick={clearFilters}>
						<X class="h-3.5 w-3.5" /> Clear
					</button>
				{/if}
				<button
					class="k-btn k-btn-sm"
					class:filters-open={showFilters}
					onclick={() => (showFilters = !showFilters)}
					aria-expanded={showFilters}
					aria-controls="tl-filters"
				>
					<ListFilter class="h-3.5 w-3.5" />
					Filter
					{#if activeFilters > 0}
						<span class="k-badge k-badge-accent">{activeFilters}</span>
					{/if}
				</button>
			</div>
		</header>

		{#if showFilters}
			<div class="tl-filters" id="tl-filters">
				<div class="filter-group">
					<label class="k-label" for="tl-type-filter">Type</label>
					<select id="tl-type-filter" class="k-input" bind:value={typeFilter}>
						<option value={null}>All types</option>
						<option value="note">Notes</option>
						<option value="voice-memo">Voice memos</option>
						<option value="meeting">Meetings</option>
					</select>
				</div>
				<div class="filter-group">
					<label class="k-label" for="tl-person-filter">Person</label>
					<select id="tl-person-filter" class="k-input" bind:value={personFilter}>
						<option value={null}>All people</option>
						{#each people.slice(0, 30) as p}
							<option value={p.name}>{p.name} ({p.count})</option>
						{/each}
					</select>
				</div>
				<div class="filter-group">
					<label class="k-label" for="tl-tag-filter">Tag</label>
					<select id="tl-tag-filter" class="k-input" bind:value={tagFilter}>
						<option value={null}>All tags</option>
						{#each tags.slice(0, 30) as t}
							<option value={t.tag}>#{t.tag} ({t.count})</option>
						{/each}
					</select>
				</div>
			</div>
		{/if}

		{#if grouped.length === 0}
			<div class="k-empty">
				<Clock />
				{#if activeFilters > 0}
					<div class="k-empty-title">No matches</div>
					<p>No memories match these filters.</p>
					<button class="k-btn" onclick={clearFilters}>Clear filters</button>
				{:else}
					<div class="k-empty-title">Nothing here yet</div>
					<p>Notes, voice memos and meetings will appear here as you capture them.</p>
				{/if}
			</div>
		{:else}
			{#each grouped as group (group.date)}
				<section class="tl-day">
					<h2 class="tl-day-label">{group.label}</h2>
					<ul class="tl-list">
						{#each group.items as m (m.id)}
							{@const Icon = typeIcon(m.type)}
							<li>
								<a class="k-row tl-row" href="/memory/{m.id}">
									<Icon class="tl-icon h-4 w-4 shrink-0" />
									<div class="min-w-0 flex-1">
										<div class="tl-title">{m.title || 'Untitled'}</div>
										{#if m.summaryShort}
											<p class="tl-summary">{m.summaryShort}</p>
										{:else if m.bodyMarkdown}
											<p class="tl-summary">{m.bodyMarkdown.slice(0, 120)}{m.bodyMarkdown.length > 120 ? '…' : ''}</p>
										{/if}
										{#if (m.tags?.length ?? 0) > 0 || (m.participants?.length ?? 0) > 0}
											<div class="tl-meta">
												{#each (m.participants ?? []).slice(0, 3) as p}
													<span class="ref-person">@{p}</span>
												{/each}
												{#each (m.tags ?? []).slice(0, 3) as t}
													<span class="ref-tag">#{t}</span>
												{/each}
											</div>
										{/if}
									</div>
									<span class="tl-time">{formatTime(m.createdAt)}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>
</div>

<style>
	.tl-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.filters-open {
		background: var(--color-active);
	}

	.tl-filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.tl-day + .tl-day {
		margin-top: 1rem;
	}

	/* Date label sticks to the top of the scroll area while its day is in view */
	.tl-day-label {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.5rem 0.625rem 0.375rem;
		background: var(--color-bg);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-faint);
	}

	.tl-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tl-row {
		align-items: flex-start;
	}

	.tl-row :global(.tl-icon) {
		margin-top: 0.125rem;
		color: var(--color-text-faint);
	}

	.tl-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.tl-summary {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.tl-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.75rem;
	}

	.ref-person {
		color: var(--color-ref-person);
	}

	.ref-tag {
		color: var(--color-ref-tag);
	}

	.tl-time {
		flex-shrink: 0;
		padding-top: 0.125rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}
</style>
