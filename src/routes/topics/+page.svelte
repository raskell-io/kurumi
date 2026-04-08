<script lang="ts">
	import {
		memoryObjects,
		getAllExtractedTopics,
		getAllExtractedProjects,
		proposeTopicMerges,
		proposeProjectMerges,
		mergeTopics,
		mergeProjects,
		renameTopic,
		renameProject,
		restoreFromStringArrayRenameSnapshot
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { onMount } from 'svelte';
	import { Tag, GitMerge, ArrowRight, Pencil, Check, X, FolderKanban, Hash } from 'lucide-svelte';

	type Kind = 'topic' | 'project';
	let activeKind = $state<Kind>('topic');

	// Re-derive when memories change so edits propagate immediately.
	let topics = $derived.by(() => {
		void $memoryObjects;
		return getAllExtractedTopics();
	});

	let projects = $derived.by(() => {
		void $memoryObjects;
		return getAllExtractedProjects();
	});

	let topicProposals = $derived.by(() => {
		void $memoryObjects;
		return proposeTopicMerges();
	});

	let projectProposals = $derived.by(() => {
		void $memoryObjects;
		return proposeProjectMerges();
	});

	let currentList = $derived(activeKind === 'topic' ? topics : projects);
	let currentProposals = $derived(
		activeKind === 'topic' ? topicProposals : projectProposals
	);

	let renaming = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(name: string) {
		renaming = name;
		renameValue = name;
	}

	function cancelRename() {
		renaming = null;
		renameValue = '';
	}

	function submitRename() {
		if (!renaming) return;
		const next = renameValue.trim();
		if (!next || next === renaming) {
			cancelRename();
			return;
		}
		const from = renaming;
		const kind = activeKind;
		const snapshot = kind === 'topic'
			? renameTopic(renaming, next)
			: renameProject(renaming, next);
		if (snapshot) {
			pushUndo({
				label: `Renamed ${kind} "${from}" → "${next}"`,
				undo: () => restoreFromStringArrayRenameSnapshot(snapshot)
			});
		}
		cancelRename();
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitRename();
		} else if (e.key === 'Escape') {
			cancelRename();
		}
	}

	// Keyboard navigation over the current tab's list.
	let focusIndex = $state(-1);
	// Reset focus when switching tabs so we don't point into a shorter list.
	$effect(() => {
		void activeKind;
		focusIndex = -1;
	});

	function handlePageKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}
		if (currentList.length === 0) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusIndex = Math.min(currentList.length - 1, focusIndex < 0 ? 0 : focusIndex + 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusIndex = Math.max(0, focusIndex < 0 ? 0 : focusIndex - 1);
				break;
			case 'Enter': {
				if (activeKind !== 'topic') break;
				const entry = currentList[focusIndex];
				if (entry)
					window.location.hash = `#/read/topic/${encodeURIComponent(entry.name)}`;
				break;
			}
			case 'r':
			case 'R': {
				e.preventDefault();
				const entry = currentList[focusIndex];
				if (entry) startRename(entry.name);
				break;
			}
			case '1':
				e.preventDefault();
				activeKind = 'topic';
				break;
			case '2':
				e.preventDefault();
				activeKind = 'project';
				break;
			case 'Escape':
				if (focusIndex >= 0) focusIndex = -1;
				break;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageKeydown);
		return () => window.removeEventListener('keydown', handlePageKeydown);
	});

	function handleMerge(source: string, target: string) {
		const kindLabel = activeKind === 'topic' ? 'topic' : 'project';
		if (
			confirm(
				`Merge ${kindLabel} "${source}" → "${target}"?\n\nEvery memory that references "${source}" will be updated to reference "${target}" instead.`
			)
		) {
			const snapshot = activeKind === 'topic'
				? mergeTopics(source, target)
				: mergeProjects(source, target);
			if (snapshot) {
				pushUndo({
					label: `Merged ${kindLabel} "${source}" → "${target}"`,
					undo: () => restoreFromStringArrayRenameSnapshot(snapshot)
				});
			}
		}
	}

	function viewHref(name: string): string {
		const path = activeKind === 'topic' ? 'topic' : 'topic'; // projects route not present; topics covers both
		return `/read/${path}/${encodeURIComponent(name)}`;
	}
</script>

<svelte:head>
	<title>Topics & projects - Kurumi</title>
</svelte:head>

<main class="topics-page">
	<header class="page-header">
		<div class="header-icon">
			<Hash class="h-8 w-8" />
		</div>
		<h1>Topics & projects</h1>
		<p class="count">
			{topics.length} topic{topics.length === 1 ? '' : 's'} ·
			{projects.length} project{projects.length === 1 ? '' : 's'}
			<span class="hint">1/2 tab · j/k nav · Enter open · r rename</span>
		</p>
	</header>

	<div class="tabs" role="tablist">
		<button
			class="tab"
			class:active={activeKind === 'topic'}
			onclick={() => (activeKind = 'topic')}
			role="tab"
			aria-selected={activeKind === 'topic'}
		>
			<Tag class="h-4 w-4" />
			Topics
			<span class="count-pill">{topics.length}</span>
		</button>
		<button
			class="tab"
			class:active={activeKind === 'project'}
			onclick={() => (activeKind = 'project')}
			role="tab"
			aria-selected={activeKind === 'project'}
		>
			<FolderKanban class="h-4 w-4" />
			Projects
			<span class="count-pill">{projects.length}</span>
		</button>
	</div>

	{#if currentProposals.length > 0}
		<section class="merge-suggestions">
			<h2 class="section-title">
				<GitMerge class="h-4 w-4" />
				Possible duplicates ({currentProposals.length})
			</h2>
			<ul class="proposal-list">
				{#each currentProposals as { source, target } (source + target)}
					<li class="proposal">
						<span class="proposal-source">{source}</span>
						<ArrowRight class="h-4 w-4 text-[var(--color-text-muted)]" />
						<span class="proposal-target">{target}</span>
						<button class="merge-btn" onclick={() => handleMerge(source, target)}>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if currentList.length === 0}
		<div class="empty-state">
			<p>
				No {activeKind === 'topic' ? 'topics' : 'projects'} yet. These are
				populated automatically when Kurumi extracts entities from voice
				memos and meetings.
			</p>
		</div>
	{:else}
		<section class="all-items">
			<ul class="items-list">
				{#each currentList as { name, count }, i (name)}
					<li class="item-row" class:focused={focusIndex === i}>
						{#if renaming === name}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:value={renameValue}
								onkeydown={handleRenameKeydown}
								onblur={submitRename}
								class="rename-input"
								autofocus
							/>
							<button class="icon-btn save" onclick={submitRename} title="Save">
								<Check class="h-4 w-4" />
							</button>
							<button class="icon-btn" onclick={cancelRename} title="Cancel">
								<X class="h-4 w-4" />
							</button>
						{:else}
							{#if activeKind === 'topic'}
								<a href={viewHref(name)} class="item-link">
									<span class="item-name">{name}</span>
								</a>
							{:else}
								<span class="item-link">
									<span class="item-name">{name}</span>
								</span>
							{/if}
							<span class="item-count">{count}</span>
							<button class="icon-btn" onclick={() => startRename(name)} title="Rename">
								<Pencil class="h-4 w-4" />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	.topics-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.header-icon {
		display: inline-flex;
		padding: 1rem;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: 1rem;
		margin-bottom: 0.75rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.count {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.hint {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		margin-bottom: -1px;
	}

	.tab:hover {
		color: var(--color-text);
	}

	.tab.active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}

	.count-pill {
		padding: 0.125rem 0.5rem;
		background: var(--color-bg-secondary);
		border-radius: 999px;
		font-size: 0.75rem;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.merge-suggestions {
		margin-bottom: 2rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		border-radius: 0.75rem;
	}

	.proposal-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.proposal {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg);
		border-radius: 0.5rem;
	}

	.proposal-source,
	.proposal-target {
		font-size: 0.875rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.merge-btn {
		margin-left: auto;
		padding: 0.375rem 0.875rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.merge-btn:hover {
		background: var(--color-accent-hover);
	}

	.items-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.5rem;
	}

	.item-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}

	.item-row:hover {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.item-row.focused {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.item-link {
		flex: 1;
		min-width: 0;
		text-decoration: none;
		color: var(--color-text);
	}

	.item-name {
		font-weight: 500;
		font-size: 0.875rem;
	}

	.item-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding: 0.125rem 0.5rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.icon-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.icon-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.icon-btn.save:hover {
		color: var(--color-accent);
	}

	.rename-input {
		flex: 1;
		min-width: 0;
		background: var(--color-bg);
		border: 1px solid var(--color-accent);
		border-radius: 0.375rem;
		padding: 0.25rem 0.5rem;
		color: var(--color-text);
		font-size: 0.875rem;
		outline: none;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}
</style>
