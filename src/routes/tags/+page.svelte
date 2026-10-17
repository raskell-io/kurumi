<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import {
		memoryObjects,
		getAllTags,
		renameTag,
		mergeTags,
		restoreFromTagRenameSnapshot,
		proposeTagMerges,
		getLowValueTags
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Tag, GitMerge, ArrowRight, Pencil, Check, X } from 'lucide-svelte';

	// Re-derive every time memory objects change (edits to bodyMarkdown).
	let allTags = $derived.by(() => {
		void $memoryObjects;
		return getAllTags();
	});

	let proposals = $derived.by(() => {
		void $memoryObjects;
		return proposeTagMerges();
	});

	let lowValue = $derived.by(() => {
		void $memoryObjects;
		return getLowValueTags();
	});

	// Rename in-place state. Only one tag can be edited at a time.
	let renamingTag = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(tag: string) {
		renamingTag = tag;
		renameValue = tag;
	}

	function cancelRename() {
		renamingTag = null;
		renameValue = '';
	}

	function submitRename() {
		if (!renamingTag) return;
		const trimmed = renameValue.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
		if (!trimmed || trimmed === renamingTag) {
			cancelRename();
			return;
		}
		const from = renamingTag;
		const snapshot = renameTag(renamingTag, trimmed);
		if (snapshot) {
			pushUndo({
				label: `Renamed #${from} → #${trimmed}`,
				undo: () => restoreFromTagRenameSnapshot(snapshot)
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

	// Keyboard navigation
	let focusIndex = $state(-1);

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
		if (allTags.length === 0) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusIndex = Math.min(allTags.length - 1, focusIndex < 0 ? 0 : focusIndex + 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusIndex = Math.max(0, focusIndex < 0 ? 0 : focusIndex - 1);
				break;
			case 'Enter': {
				// A focused button/link handles its own Enter.
				if (target.tagName === 'BUTTON' || target.tagName === 'A') break;
				const entry = allTags[focusIndex];
				if (entry) goto(`/read/tag/${encodeURIComponent(entry.tag)}`);
				break;
			}
			case 'r':
			case 'R': {
				e.preventDefault();
				const entry = allTags[focusIndex];
				if (entry) startRename(entry.tag);
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

	// Rewrites every #source to #target across all notes. Undoable via
	// the undo toast / Cmd+Z, so no confirm prompt.
	function handleMerge(source: string, target: string) {
		const snapshot = mergeTags(source, target);
		if (snapshot) {
			pushUndo({
				label: `Merged #${source} → #${target}`,
				undo: () => restoreFromTagRenameSnapshot(snapshot)
			});
		}
	}
</script>

<svelte:head>
	<title>Tags - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Tags</h1>
			<p class="k-page-subtitle">
				{allTags.length} {allTags.length === 1 ? 'tag' : 'tags'} in use
			</p>
			{#if allTags.length > 0}
				<div class="k-hints">
					<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
					<span><kbd class="k-kbd">↵</kbd> open</span>
					<span><kbd class="k-kbd">r</kbd> rename</span>
				</div>
			{/if}
		</div>
	</header>

	{#if proposals.length > 0}
		<section class="mb-6">
			<h2 class="k-section-title !mt-0">
				<GitMerge class="h-3.5 w-3.5" />
				Possible duplicates
				<span class="k-badge">{proposals.length}</span>
			</h2>
			<ul class="merge-group">
				{#each proposals as { source, target } (source + target)}
					<li class="k-row">
						<span class="min-w-0 truncate text-[var(--color-text-muted)]">#{source}</span>
						<ArrowRight class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
						<span class="min-w-0 flex-1 truncate font-medium">#{target}</span>
						<button
							class="k-btn k-btn-primary k-btn-sm"
							onclick={() => handleMerge(source, target)}
							title="Rewrite every #{source} to #{target}"
						>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if lowValue.length > 0}
		<section class="mb-6">
			<h2 class="k-section-title">
				Used once
				<span class="k-badge">{lowValue.length}</span>
			</h2>
			<p class="mb-2.5 px-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
				Each of these appears in a single note. Rename them into a shared tag,
				or drop them if the category isn't useful.
			</p>
			<div class="flex flex-wrap gap-1.5 px-1">
				{#each lowValue as { tag } (tag)}
					<a href="/read/tag/{encodeURIComponent(tag)}" class="k-badge hover:!text-[var(--color-text)]">#{tag}</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if allTags.length === 0}
		<div class="k-empty">
			<Tag />
			<p class="k-empty-title">No tags yet</p>
			<p>Add #tag-name to any note to start categorizing.</p>
		</div>
	{:else}
		<section>
			{#if proposals.length > 0 || lowValue.length > 0}
				<h2 class="k-section-title">All tags</h2>
			{/if}
			<ul>
				{#each allTags as { tag, count }, i (tag)}
					<li class="k-row" class:focused={focusIndex === i} data-row-index={i}>
						{#if renamingTag === tag}
														<input
								type="text"
								bind:value={renameValue}
								onkeydown={handleRenameKeydown}
								onblur={submitRename}
								class="k-input !h-7 flex-1 !px-2"
								aria-label="New name for #{tag}"
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
							<a href="/read/tag/{encodeURIComponent(tag)}" class="min-w-0 flex-1 truncate">
								<span class="text-[var(--color-text-faint)]">#</span>{tag}
							</a>
							<span class="k-badge" title="{count} note{count === 1 ? '' : 's'}">{count}</span>
							<button
								class="k-icon-btn row-action"
								onclick={() => startRename(tag)}
								aria-label="Rename #{tag}"
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
