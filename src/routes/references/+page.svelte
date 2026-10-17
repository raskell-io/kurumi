<script lang="ts">
	import {
		getAllTags,
		getAllLinks,
		getAllPeopleWithMetadata,
		getAllDatesWithEvents,
		getMemoryObjectsByTag,
		getMemoryObjectsByLink,
		people as peopleStore,
		events as eventsStore,
		type MemoryObject
	} from '$lib/db';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Tag, User, Calendar, Link, ChevronRight, ExternalLink, Globe } from 'lucide-svelte';
	import PersonCard from '$lib/components/PersonCard.svelte';
	import AgendaView from '$lib/components/AgendaView.svelte';
	import ExportMenu from '$lib/components/ExportMenu.svelte';

	type TabType = 'tags' | 'people' | 'dates' | 'links';

	// Get initial values from URL params
	let initialTab = ($page.url.searchParams.get('tab') as TabType) || 'tags';
	let initialItem = $page.url.searchParams.get('item');

	const tabs: { id: TabType; label: string; icon: typeof Tag }[] = [
		{ id: 'tags', label: 'Tags', icon: Tag },
		{ id: 'people', label: 'People', icon: User },
		{ id: 'dates', label: 'Dates', icon: Calendar },
		{ id: 'links', label: 'Links', icon: Link }
	];

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

	// Get memories for expanded item (tags and links only)
	let expandedMemories = $derived.by(() => {
		if (!expandedItem) return [];
		switch (activeTab) {
			case 'tags':
				return getMemoryObjectsByTag(expandedItem);
			case 'links':
				return getMemoryObjectsByLink(expandedItem);
			default:
				return [];
		}
	});

	function tabCount(tab: TabType): number {
		switch (tab) {
			case 'tags':
				return allTags.length;
			case 'people':
				return allPeople.length;
			case 'dates':
				return allDates.length;
			case 'links':
				return allLinks.length;
		}
	}

	function selectTab(tab: TabType) {
		activeTab = tab;
		expandedItem = null;
	}

	function toggleExpand(item: string) {
		expandedItem = expandedItem === item ? null : item;
	}

	function openMemory(memoryId: string) {
		goto(`/memory/${memoryId}`);
	}

	function getPreview(memory: MemoryObject): string {
		const content = memory.bodyMarkdown
			.replace(/^---[\s\S]*?---\n?/, '') // Remove frontmatter
			.replace(/[#@\/\[\]]/g, '')
			.trim();
		return content.slice(0, 100) + (content.length > 100 ? '...' : '');
	}
</script>

<svelte:head>
	<title>References - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">References</h1>
			<p class="k-page-subtitle">Browse tags, people, dates, and links across your notes</p>
		</div>
	</header>

	<div class="toolbar">
		<div class="k-segmented tabs" role="group" aria-label="Reference type">
			{#each tabs as tab (tab.id)}
				<button aria-pressed={activeTab === tab.id} onclick={() => selectTab(tab.id)}>
					<tab.icon class="h-3.5 w-3.5" />
					{tab.label}
					<span class="tab-count">{tabCount(tab.id)}</span>
				</button>
			{/each}
		</div>

		<!-- Manage + export -->
		<div class="tab-actions">
			{#if activeTab === 'tags'}
				<a href="/tags" class="k-btn k-btn-ghost k-btn-sm">Manage</a>
				<ExportMenu type="tags" tags={allTags} />
			{:else if activeTab === 'people'}
				<a href="/people" class="k-btn k-btn-ghost k-btn-sm">Manage</a>
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
				<div class="k-empty">
					<Tag />
					<p class="k-empty-title">No tags yet</p>
					<p>Use #tag in your notes to create tags.</p>
				</div>
			{:else}
				<ul class="items-list">
					{#each allTags as tag (tag.tag)}
						{@const isOpen = expandedItem === tag.tag}
						<li>
							<button class="k-row item-header" class:open={isOpen} onclick={() => toggleExpand(tag.tag)} aria-expanded={isOpen}>
								<ChevronRight class="chevron h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] {isOpen ? 'expanded' : ''}" />
								<span class="item-name"><span class="tag-hash">#</span>{tag.tag}</span>
								<span class="item-count">{tag.count} {tag.count === 1 ? 'note' : 'notes'}</span>
							</button>
							{#if isOpen}
								<ul class="notes-list">
									{#each expandedMemories as memory (memory.id)}
										<li>
											<button class="k-row note-item" onclick={() => openMemory(memory.id)}>
												<span class="note-title">{memory.title || 'Untitled'}</span>
												<span class="note-preview">{getPreview(memory)}</span>
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
				<div class="k-empty">
					<User />
					<p class="k-empty-title">No people yet</p>
					<p>Use @Full Name in your notes to mention people.</p>
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
				<div class="k-empty">
					<Link />
					<p class="k-empty-title">No links yet</p>
					<p>Add URLs in your notes to track external links.</p>
				</div>
			{:else}
				<ul class="items-list">
					{#each linksByDomain as domainGroup (domainGroup.domain)}
						{@const domainOpen = expandedDomains.has(domainGroup.domain)}
						<li>
							<button class="k-row item-header" class:open={domainOpen} onclick={() => toggleDomain(domainGroup.domain)} aria-expanded={domainOpen}>
								<ChevronRight class="chevron h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] {domainOpen ? 'expanded' : ''}" />
								<Globe class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
								<span class="item-name">{domainGroup.domain}</span>
								<span class="item-count">{domainGroup.links.length} {domainGroup.links.length === 1 ? 'link' : 'links'}</span>
							</button>
							{#if domainOpen}
								<ul class="nested">
									{#each domainGroup.links as link (link.url)}
										{@const linkOpen = expandedItem === link.url}
										<li>
											<!-- Toggle and external link are siblings: no <a> inside <button> -->
											<div class="k-row link-row" class:open={linkOpen}>
												<button class="link-toggle" onclick={() => toggleExpand(link.url)} aria-expanded={linkOpen}>
													<ChevronRight class="chevron h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] {linkOpen ? 'expanded' : ''}" />
													<span class="link-url-text">{link.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
													<span class="item-count">{link.count}</span>
												</button>
												<a
													href={link.url}
													target="_blank"
													rel="noopener noreferrer"
													class="k-icon-btn external-link"
													title="Open link"
													aria-label="Open link"
												>
													<ExternalLink class="h-3.5 w-3.5" />
												</a>
											</div>
											{#if linkOpen}
												<ul class="notes-list">
													{#each expandedMemories as memory (memory.id)}
														<li>
															<button class="k-row note-item" onclick={() => openMemory(memory.id)}>
																<span class="note-title">{memory.title || 'Untitled'}</span>
																<span class="note-preview">{getPreview(memory)}</span>
															</button>
														</li>
													{/each}
												</ul>
											{/if}
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
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.tabs {
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar {
		display: none;
	}

	.tabs > button {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		white-space: nowrap;
	}

	.tab-count {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	.tab-actions {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	.tab-actions a {
		text-decoration: none;
	}

	.content {
		min-height: 400px;
	}

	/* Rows bleed into the gutter so text aligns with the page title */
	.items-list {
		margin: 0 -0.625rem;
		padding: 0;
		list-style: none;
	}

	.item-header {
		width: 100%;
		text-align: left;
	}

	.item-header.open,
	.link-row.open {
		background: var(--color-hover);
	}

	.item-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.tag-hash {
		margin-right: 0.0625rem;
		color: var(--color-ref-tag);
	}

	.item-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	/* Second level (links within a domain, notes within an item) */
	.nested,
	.notes-list {
		margin: 0.125rem 0 0.5rem 1.375rem;
		padding: 0 0 0 0.375rem;
		border-left: 1px solid var(--color-border);
		list-style: none;
	}

	.note-item {
		width: 100%;
		text-align: left;
	}

	.note-title {
		flex-shrink: 0;
		max-width: 55%;
		overflow: hidden;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.note-preview {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.link-row {
		gap: 0.25rem;
		padding-right: 0.25rem;
	}

	.link-toggle {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		text-align: left;
	}

	.link-url-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.external-link {
		color: var(--color-text-faint);
	}

	@media (max-width: 640px) {
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.tab-actions {
			margin-left: 0;
			justify-content: flex-end;
		}

		.note-preview {
			display: none;
		}

		.note-title {
			flex: 1;
			max-width: none;
		}
	}
</style>
