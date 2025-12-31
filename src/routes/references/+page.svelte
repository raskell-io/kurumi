<script lang="ts">
	import { getAllTags, getAllPeople, getAllDates, getNotesByTag, getNotesByPerson, getNotesByDate, type Note } from '$lib/db';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Tag, User, Calendar, ChevronRight } from 'lucide-svelte';

	type TabType = 'tags' | 'people' | 'dates';

	// Get initial values from URL params
	let initialTab = ($page.url.searchParams.get('tab') as TabType) || 'tags';
	let initialItem = $page.url.searchParams.get('item');

	let activeTab = $state<TabType>(initialTab);
	let expandedItem = $state<string | null>(initialItem);

	// Get all data
	let allTags = $derived(getAllTags());
	let allPeople = $derived(getAllPeople());
	let allDates = $derived(getAllDates());

	// Get notes for expanded item
	let expandedNotes = $derived.by(() => {
		if (!expandedItem) return [];
		switch (activeTab) {
			case 'tags':
				return getNotesByTag(expandedItem);
			case 'people':
				return getNotesByPerson(expandedItem);
			case 'dates':
				return getNotesByDate(expandedItem);
			default:
				return [];
		}
	});

	function toggleExpand(item: string) {
		expandedItem = expandedItem === item ? null : item;
	}

	function openNote(noteId: string) {
		goto(`/note/${noteId}`);
	}

	function formatDate(dateStr: string): string {
		try {
			const date = new Date(dateStr + 'T00:00:00');
			return date.toLocaleDateString('en-US', {
				weekday: 'short',
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	function getRelativeDate(dateStr: string): string {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const date = new Date(dateStr + 'T00:00:00');
		const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		if (diffDays === -1) return 'Yesterday';
		if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
		if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
		return '';
	}

	function getPreview(note: Note): string {
		const content = note.content.replace(/[#@\/\[\]]/g, '').trim();
		return content.slice(0, 100) + (content.length > 100 ? '...' : '');
	}
</script>

<svelte:head>
	<title>References - Kurumi</title>
</svelte:head>

<div class="references-page">
	<header class="page-header">
		<h1>References</h1>
		<p class="subtitle">Browse all tags, people, and dates across your notes</p>
	</header>

	<div class="tabs">
		<button
			class="tab"
			class:active={activeTab === 'tags'}
			onclick={() => { activeTab = 'tags'; expandedItem = null; }}
		>
			<Tag class="h-4 w-4" />
			Tags
			<span class="count">{allTags.length}</span>
		</button>
		<button
			class="tab"
			class:active={activeTab === 'people'}
			onclick={() => { activeTab = 'people'; expandedItem = null; }}
		>
			<User class="h-4 w-4" />
			People
			<span class="count">{allPeople.length}</span>
		</button>
		<button
			class="tab"
			class:active={activeTab === 'dates'}
			onclick={() => { activeTab = 'dates'; expandedItem = null; }}
		>
			<Calendar class="h-4 w-4" />
			Dates
			<span class="count">{allDates.length}</span>
		</button>
	</div>

	<div class="content">
		{#if activeTab === 'tags'}
			{#if allTags.length === 0}
				<div class="empty-state">
					<Tag class="h-12 w-12" />
					<h3>No tags yet</h3>
					<p>Use #tag in your notes to create tags</p>
				</div>
			{:else}
				<ul class="items-list">
					{#each allTags as tag (tag.tag)}
						<li class="item" class:expanded={expandedItem === tag.tag}>
							<button class="item-header" onclick={() => toggleExpand(tag.tag)}>
								<div class="item-icon tag-icon">
									<Tag class="h-4 w-4" />
								</div>
								<span class="item-name">#{tag.tag}</span>
								<span class="item-count">{tag.count} {tag.count === 1 ? 'note' : 'notes'}</span>
								<ChevronRight class="chevron {expandedItem === tag.tag ? 'rotated' : ''}" />
							</button>
							{#if expandedItem === tag.tag}
								<ul class="notes-list">
									{#each expandedNotes as note (note.id)}
										<li>
											<button class="note-item" onclick={() => openNote(note.id)}>
												<span class="note-title">{note.title || 'Untitled'}</span>
												<span class="note-preview">{getPreview(note)}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'people'}
			{#if allPeople.length === 0}
				<div class="empty-state">
					<User class="h-12 w-12" />
					<h3>No people yet</h3>
					<p>Use @Full Name in your notes to mention people</p>
				</div>
			{:else}
				<ul class="items-list">
					{#each allPeople as person (person.name)}
						<li class="item" class:expanded={expandedItem === person.name}>
							<button class="item-header" onclick={() => toggleExpand(person.name)}>
								<div class="item-icon person-icon">
									<User class="h-4 w-4" />
								</div>
								<span class="item-name">@{person.name}</span>
								<span class="item-count">{person.count} {person.count === 1 ? 'note' : 'notes'}</span>
								<ChevronRight class="chevron {expandedItem === person.name ? 'rotated' : ''}" />
							</button>
							{#if expandedItem === person.name}
								<ul class="notes-list">
									{#each expandedNotes as note (note.id)}
										<li>
											<button class="note-item" onclick={() => openNote(note.id)}>
												<span class="note-title">{note.title || 'Untitled'}</span>
												<span class="note-preview">{getPreview(note)}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'dates'}
			{#if allDates.length === 0}
				<div class="empty-state">
					<Calendar class="h-12 w-12" />
					<h3>No dates yet</h3>
					<p>Use //YYYY-MM-DD in your notes to reference dates</p>
				</div>
			{:else}
				<ul class="items-list">
					{#each allDates as date (date.date)}
						<li class="item" class:expanded={expandedItem === date.date}>
							<button class="item-header" onclick={() => toggleExpand(date.date)}>
								<div class="item-icon date-icon">
									<Calendar class="h-4 w-4" />
								</div>
								<div class="date-info">
									<span class="item-name">{formatDate(date.date)}</span>
									{#if getRelativeDate(date.date)}
										<span class="relative-date">{getRelativeDate(date.date)}</span>
									{/if}
								</div>
								<span class="item-count">{date.count} {date.count === 1 ? 'note' : 'notes'}</span>
								<ChevronRight class="chevron {expandedItem === date.date ? 'rotated' : ''}" />
							</button>
							{#if expandedItem === date.date}
								<ul class="notes-list">
									{#each expandedNotes as note (note.id)}
										<li>
											<button class="note-item" onclick={() => openNote(note.id)}>
												<span class="note-title">{note.title || 'Untitled'}</span>
												<span class="note-preview">{getPreview(note)}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<style>
	.references-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 1.75rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.5rem;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: transparent;
		border: none;
		border-radius: 0.5rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.tab:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.tab.active {
		background: var(--color-accent);
		color: white;
	}

	.tab .count {
		background: rgba(255, 255, 255, 0.2);
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
		font-size: 0.75rem;
	}

	.tab:not(.active) .count {
		background: var(--color-bg-secondary);
	}

	.content {
		min-height: 400px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.empty-state svg {
		margin-bottom: 1rem;
		opacity: 0.5;
	}

	.empty-state h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.empty-state p {
		font-size: 0.875rem;
	}

	.items-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.item {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		overflow: hidden;
		transition: all 0.15s ease;
	}

	.item:hover {
		border-color: var(--color-accent);
	}

	.item.expanded {
		border-color: var(--color-accent);
	}

	.item-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.item-header:hover {
		background: var(--color-bg-secondary);
	}

	.item-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		flex-shrink: 0;
	}

	.tag-icon {
		background: rgba(245, 158, 11, 0.15);
		color: #f59e0b;
	}

	.person-icon {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.date-icon {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.item-name {
		flex: 1;
		font-weight: 500;
		color: var(--color-text);
	}

	.date-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.relative-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.item-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 1rem;
	}

	.chevron {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-text-muted);
		transition: transform 0.15s ease;
	}

	.chevron.rotated {
		transform: rotate(90deg);
	}

	.notes-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.notes-list li {
		border-bottom: 1px solid var(--color-border);
	}

	.notes-list li:last-child {
		border-bottom: none;
	}

	.note-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		padding: 0.75rem 1rem 0.75rem 3.5rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.note-item:hover {
		background: var(--color-bg);
	}

	.note-title {
		font-weight: 500;
		color: var(--color-text);
	}

	.note-preview {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 640px) {
		.references-page {
			padding: 1rem;
		}

		.tabs {
			overflow-x: auto;
		}

		.tab {
			white-space: nowrap;
		}
	}
</style>
