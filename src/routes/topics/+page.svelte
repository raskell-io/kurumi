<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
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
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { GitMerge, ArrowRight, Pencil, Check, X, FolderKanban, Hash } from 'lucide-svelte';

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

	$effect(() => {
		if (focusIndex < 0) return;
		document
			.querySelector(`[data-row-index="${focusIndex}"]`)
			?.scrollIntoView({ block: 'nearest' });
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
		// Leave global shortcuts (Cmd+K, Cmd+R, ...) alone.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		// Tab switching works even when the current list is empty.
		if (e.key === '1' || e.key === '2') {
			e.preventDefault();
			activeKind = e.key === '1' ? 'topic' : 'project';
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
				// A focused button/link handles its own Enter.
				if (target.tagName === 'BUTTON' || target.tagName === 'A') break;
				const entry = currentList[focusIndex];
				if (entry) goto(viewHref(entry.name));
				break;
			}
			case 'r':
			case 'R': {
				e.preventDefault();
				const entry = currentList[focusIndex];
				if (entry) startRename(entry.name);
				break;
			}
			case 'Escape':
				if (focusIndex >= 0) focusIndex = -1;
				break;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageKeydown);
		return () => window.removeEventListener('keydown', handlePageKeydown);
	});

	// Repoints every memory referencing source to target. Undoable via
	// the undo toast / Cmd+Z, so no confirm prompt.
	function handleMerge(source: string, target: string) {
		const kindLabel = activeKind === 'topic' ? 'topic' : 'project';
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

	// Only topics have a read filter route; projects render as plain rows.
	function viewHref(name: string): string {
		return `/read/topic/${encodeURIComponent(name)}`;
	}
</script>

<svelte:head>
	<title>Topics & projects - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Topics & projects</h1>
			<p class="k-page-subtitle">Extracted automatically from voice memos and meetings</p>
			<div class="k-hints">
				<span><kbd class="k-kbd">1</kbd> <kbd class="k-kbd">2</kbd> switch</span>
				<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
				<span><kbd class="k-kbd">↵</kbd> open</span>
				<span><kbd class="k-kbd">r</kbd> rename</span>
			</div>
		</div>
	</header>

	<div class="k-segmented mb-6" role="group" aria-label="Kind">
		<button
			class="inline-flex items-center gap-1.5"
			onclick={() => (activeKind = 'topic')}
			aria-pressed={activeKind === 'topic'}
		>
			<Hash class="h-3.5 w-3.5" />
			Topics
			<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{topics.length}</span>
		</button>
		<button
			class="inline-flex items-center gap-1.5"
			onclick={() => (activeKind = 'project')}
			aria-pressed={activeKind === 'project'}
		>
			<FolderKanban class="h-3.5 w-3.5" />
			Projects
			<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{projects.length}</span>
		</button>
	</div>

	{#if currentProposals.length > 0}
		<section class="mb-6">
			<h2 class="k-section-title !mt-0">
				<GitMerge class="h-3.5 w-3.5" />
				Possible duplicates
				<span class="k-badge">{currentProposals.length}</span>
			</h2>
			<ul class="merge-group">
				{#each currentProposals as { source, target } (source + target)}
					<li class="k-row">
						<span class="min-w-0 truncate text-[var(--color-text-muted)]">{source}</span>
						<ArrowRight class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
						<span class="min-w-0 flex-1 truncate font-medium">{target}</span>
						<button
							class="k-btn k-btn-primary k-btn-sm"
							onclick={() => handleMerge(source, target)}
							title="Repoint every reference to {target}"
						>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if currentList.length === 0}
		<div class="k-empty">
			{#if activeKind === 'topic'}
				<Hash />
			{:else}
				<FolderKanban />
			{/if}
			<p class="k-empty-title">No {activeKind === 'topic' ? 'topics' : 'projects'} yet</p>
			<p>They appear when Kurumi extracts entities from voice memos and meetings.</p>
		</div>
	{:else}
		<section>
			{#if currentProposals.length > 0}
				<h2 class="k-section-title">All {activeKind === 'topic' ? 'topics' : 'projects'}</h2>
			{/if}
			<ul>
				{#each currentList as { name, count }, i (name)}
					<li class="k-row" class:focused={focusIndex === i} data-row-index={i}>
						{#if renaming === name}
														<input
								type="text"
								bind:value={renameValue}
								onkeydown={handleRenameKeydown}
								onblur={submitRename}
								class="k-input !h-7 flex-1 !px-2"
								aria-label="New name for {name}"
								use:autofocus
							/>
							<!-- mousedown preventDefault keeps the input focused so
							     blur doesn't submit before the click lands -->
							<button
								class="k-icon-btn hover:!text-[var(--color-accent)]"
								onmousedown={(e) => e.preventDefault()}
								onclick={submitRename}
								aria-label="Save"
								title="Save"
							>
								<Check class="h-4 w-4" />
							</button>
							<button
								class="k-icon-btn"
								onmousedown={(e) => e.preventDefault()}
								onclick={cancelRename}
								aria-label="Cancel"
								title="Cancel"
							>
								<X class="h-4 w-4" />
							</button>
						{:else}
							{#if activeKind === 'topic'}
								<a href={viewHref(name)} class="min-w-0 flex-1 truncate">{name}</a>
							{:else}
								<span class="min-w-0 flex-1 truncate">{name}</span>
							{/if}
							<span class="k-badge" title="{count} memor{count === 1 ? 'y' : 'ies'}">{count}</span>
							<button
								class="k-icon-btn row-action"
								onclick={() => startRename(name)}
								aria-label="Rename {name}"
								title="Rename"
							>
								<Pencil class="h-4 w-4" />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	/* Merge suggestions sit in one quiet tinted group above the list */
	.merge-group {
		padding: 0.25rem;
		border-radius: var(--radius-lg);
		background: var(--color-bg-secondary);
	}

	/* Row actions appear on hover/focus (always visible on touch) */
	.row-action {
		opacity: 0;
	}

	.k-row:hover .row-action,
	.k-row.focused .row-action,
	.row-action:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.row-action {
			opacity: 1;
		}
	}
</style>
