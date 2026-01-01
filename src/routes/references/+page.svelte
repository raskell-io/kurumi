<script lang="ts">
	import {
		getAllTags,
		getAllLinks,
		getAllPeopleWithMetadata,
		getAllDatesWithEvents,
		getNotesByTag,
		getNotesByLink,
		people as peopleStore,
		events as eventsStore,
		type Note
	} from '$lib/db';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Tag, User, Calendar, Link, ChevronRight, ChevronDown, ExternalLink, Globe } from 'lucide-svelte';
	import PersonCard from '$lib/components/PersonCard.svelte';
	import AgendaView from '$lib/components/AgendaView.svelte';
	import ExportMenu from '$lib/components/ExportMenu.svelte';

	type TabType = 'tags' | 'people' | 'dates' | 'links';

	// Get initial values from URL params
	let initialTab = ($page.url.searchParams.get('tab') as TabType) || 'tags';
	let initialItem = $page.url.searchParams.get('item');

	let activeTab = $state<TabType>(initialTab);
	let expandedItem = $state<string | null>(initialItem);

	// Subscribe to stores to trigger reactivity
	let peopleData = $state(get(peopleStore));
	let eventsData = $state(get(eventsStore));
	$effect(() => {
		const unsubPeople = peopleStore.subscribe((p) => (peopleData = p));
		const unsubEvents = eventsStore.subscribe((e) => (eventsData = e));
		return () => {
			unsubPeople();
			unsubEvents();
		};
	});

	// Get all data with metadata - depends on store subscriptions for reactivity
	let allTags = $derived(getAllTags());
	let allPeople = $derived.by(() => {
		void peopleData; // Dependency trigger
		return getAllPeopleWithMetadata();
	});
	let allDates = $derived.by(() => {
		void eventsData; // Dependency trigger
		return getAllDatesWithEvents();
	});
	let allLinks = $derived(getAllLinks());

	// Group links by domain for categorized display
	let linksByDomain = $derived.by(() => {
		const grouped = new Map<string, { url: string; domain: string; count: number }[]>();
		for (const link of allLinks) {
			const existing = grouped.get(link.domain) || [];
			existing.push(link);
			grouped.set(link.domain, existing);
		}
		// Sort domains by total link count
		return Array.from(grouped.entries())
			.map(([domain, links]) => ({
				domain,
				links,
				totalCount: links.reduce((sum, l) => sum + l.count, 0)
			}))
			.sort((a, b) => b.totalCount - a.totalCount);
	});

	// Track expanded domains
	let expandedDomains = $state<Set<string>>(new Set());

	function toggleDomain(domain: string) {
		const newSet = new Set(expandedDomains);
		if (newSet.has(domain)) {
			newSet.delete(domain);
		} else {
			newSet.add(domain);
		}
		expandedDomains = newSet;
	}

	// Get notes for expanded item (tags and links only)
	let expandedNotes = $derived.by(() => {
		if (!expandedItem) return [];
		switch (activeTab) {
			case 'tags':
				return getNotesByTag(expandedItem);
			case 'links':
				return getNotesByLink(expandedItem);
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

	function getPreview(note: Note): string {
		const content = note.content
			.replace(/^---[\s\S]*?---\n?/, '') // Remove frontmatter
			.replace(/[#@\/\[\]]/g, '')
			.trim();
		return content.slice(0, 100) + (content.length > 100 ? '...' : '');
	}
</script>

<svelte:head>
	<title>References - Kurumi</title>
</svelte:head>

<div class="references-page">
	<header class="page-header">
		<h1>References</h1>
		<p class="subtitle">Browse tags, people, dates, and links across your notes</p>
	</header>

	<div class="tabs-container">
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === 'tags'}
				onclick={() => {
					activeTab = 'tags';
					expandedItem = null;
				}}
			>
				<Tag class="h-4 w-4" />
				Tags
				<span class="count">{allTags.length}</span>
			</button>
			<button
				class="tab"
				class:active={activeTab === 'people'}
				onclick={() => {
					activeTab = 'people';
					expandedItem = null;
				}}
			>
				<User class="h-4 w-4" />
				People
				<span class="count">{allPeople.length}</span>
			</button>
			<button
				class="tab"
				class:active={activeTab === 'dates'}
				onclick={() => {
					activeTab = 'dates';
					expandedItem = null;
				}}
			>
				<Calendar class="h-4 w-4" />
				Dates
				<span class="count">{allDates.length}</span>
			</button>
			<button
				class="tab"
				class:active={activeTab === 'links'}
				onclick={() => {
					activeTab = 'links';
					expandedItem = null;
				}}
			>
				<Link class="h-4 w-4" />
				Links
				<span class="count">{allLinks.length}</span>
			</button>
		</div>

		<!-- Export button -->
		<div class="tab-actions">
			{#if activeTab === 'tags'}
				<ExportMenu type="tags" tags={allTags} />
			{:else if activeTab === 'people'}
				<ExportMenu type="people" people={allPeople} />
			{:else if activeTab === 'dates'}
				<ExportMenu type="dates" dates={allDates} />
			{:else if activeTab === 'links'}
				<ExportMenu type="links" links={allLinks} />
			{/if}
		</div>
	</div>

	<div class="content">
		<!-- Tags Tab -->
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

			<!-- People Tab - Using PersonCard -->
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
						<PersonCard
							{person}
							expanded={expandedItem === person.name}
							onToggle={() => toggleExpand(person.name)}
						/>
					{/each}
				</ul>
			{/if}

			<!-- Dates Tab - Using AgendaView -->
		{:else if activeTab === 'dates'}
			<AgendaView dates={allDates} />

			<!-- Links Tab -->
		{:else if activeTab === 'links'}
			{#if allLinks.length === 0}
				<div class="empty-state">
					<Link class="h-12 w-12" />
					<h3>No links yet</h3>
					<p>Add URLs in your notes to track external links</p>
				</div>
			{:else}
				<div class="links-by-domain">
					{#each linksByDomain as domainGroup (domainGroup.domain)}
						<div class="domain-group">
							<button class="domain-header" onclick={() => toggleDomain(domainGroup.domain)}>
								<Globe class="domain-icon" />
								<span class="domain-name">{domainGroup.domain}</span>
								<span class="domain-count">{domainGroup.links.length} {domainGroup.links.length === 1 ? 'link' : 'links'}</span>
								<ChevronDown class="domain-chevron {expandedDomains.has(domainGroup.domain) ? 'rotated' : ''}" />
							</button>
							{#if expandedDomains.has(domainGroup.domain)}
								<ul class="domain-links">
									{#each domainGroup.links as link (link.url)}
										<li class="link-item" class:expanded={expandedItem === link.url}>
											<button class="link-header" onclick={() => toggleExpand(link.url)}>
												<Link class="link-icon-small" />
												<span class="link-url-text">{link.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
												<a
													href={link.url}
													target="_blank"
													rel="noopener noreferrer"
													class="external-link-btn"
													onclick={(e) => e.stopPropagation()}
													title="Open link"
												>
													<ExternalLink class="h-3.5 w-3.5" />
												</a>
												<span class="link-note-count">{link.count}</span>
												<ChevronRight class="link-chevron {expandedItem === link.url ? 'rotated' : ''}" />
											</button>
											{#if expandedItem === link.url}
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
						</div>
					{/each}
				</div>
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

	.tabs-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.5rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar {
		display: none;
	}

	.tab-actions {
		flex-shrink: 0;
	}

	.tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		border-radius: 0.5rem;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		flex-shrink: 0;
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
		padding: 0.125rem 0.375rem;
		border-radius: 1rem;
		font-size: 0.6875rem;
		min-width: 1.25rem;
		text-align: center;
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

	.empty-state h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 1rem 0 0.5rem;
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

	.link-icon {
		background: rgba(168, 85, 247, 0.15);
		color: #a855f7;
	}

	.link-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.link-url {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.external-link-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
		border-radius: 0.375rem;
		color: var(--color-text-muted);
		transition: all 0.15s ease;
	}

	.external-link-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-accent);
	}

	.item-name {
		flex: 1;
		font-weight: 500;
		color: var(--color-text);
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

	/* Links grouped by domain */
	.links-by-domain {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.domain-group {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.domain-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--color-bg);
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.domain-header:hover {
		background: var(--color-bg-secondary);
	}

	.domain-icon {
		width: 1.25rem;
		height: 1.25rem;
		color: #a855f7;
	}

	.domain-name {
		flex: 1;
		font-weight: 600;
		color: var(--color-text);
	}

	.domain-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 1rem;
	}

	.domain-chevron {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-text-muted);
		transition: transform 0.15s ease;
	}

	.domain-chevron.rotated {
		transform: rotate(180deg);
	}

	.domain-links {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.link-item {
		border-bottom: 1px solid var(--color-border);
	}

	.link-item:last-child {
		border-bottom: none;
	}

	.link-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 1rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.link-header:hover {
		background: var(--color-bg);
	}

	.link-icon-small {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.link-url-text {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.link-note-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		min-width: 1.25rem;
		text-align: center;
	}

	.link-chevron {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		transition: transform 0.15s ease;
	}

	.link-chevron.rotated {
		transform: rotate(90deg);
	}

	.link-item .notes-list {
		padding-left: 1.5rem;
	}

	.link-item .note-item {
		padding-left: 2rem;
	}

	@media (max-width: 640px) {
		.references-page {
			padding: 1rem;
		}

		.tabs-container {
			flex-direction: column;
			align-items: stretch;
		}

		.tabs {
			overflow-x: auto;
		}

		.tab-actions {
			align-self: flex-end;
		}
	}
</style>
