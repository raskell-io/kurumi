<script lang="ts">
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
	import { onMount } from 'svelte';
	import { Tag, GitMerge, ArrowRight, AlertTriangle, Pencil, Check, X } from 'lucide-svelte';

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
				const entry = allTags[focusIndex];
				if (entry) window.location.hash = `#/read/tag/${encodeURIComponent(entry.tag)}`;
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

	function handleMerge(source: string, target: string) {
		if (
			confirm(
				`Merge #${source} → #${target}?\n\nEvery occurrence of #${source} will be rewritten to #${target} across all notes.`
			)
		) {
			const snapshot = mergeTags(source, target);
			if (snapshot) {
				pushUndo({
					label: `Merged #${source} → #${target}`,
					undo: () => restoreFromTagRenameSnapshot(snapshot)
				});
			}
		}
	}
</script>

<svelte:head>
	<title>Tags - Kurumi</title>
</svelte:head>

<main class="tags-page">
	<header class="page-header">
		<div class="header-icon">
			<Tag class="h-8 w-8" />
		</div>
		<h1>Tags</h1>
		<p class="count">
			{allTags.length} {allTags.length === 1 ? 'tag' : 'tags'} in use
			{#if allTags.length > 0}
				<span class="hint">j/k nav · Enter open · r rename</span>
			{/if}
		</p>
	</header>

	{#if proposals.length > 0}
		<section class="merge-suggestions">
			<h2 class="section-title">
				<GitMerge class="h-4 w-4" />
				Possible duplicates ({proposals.length})
			</h2>
			<ul class="proposal-list">
				{#each proposals as { source, target } (source + target)}
					<li class="proposal">
						<span class="proposal-source">#{source}</span>
						<ArrowRight class="h-4 w-4 text-[var(--color-text-muted)]" />
						<span class="proposal-target">#{target}</span>
						<button class="merge-btn" onclick={() => handleMerge(source, target)}>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if lowValue.length > 0}
		<section class="low-value">
			<h2 class="section-title">
				<AlertTriangle class="h-4 w-4" />
				Used once ({lowValue.length})
			</h2>
			<p class="section-desc">
				These tags appear in exactly one note each. Consider renaming them
				into a shared tag, or removing if the categorization isn't useful.
			</p>
			<div class="low-value-list">
				{#each lowValue as { tag } (tag)}
					<span class="low-value-tag">#{tag}</span>
				{/each}
			</div>
		</section>
	{/if}

	{#if allTags.length === 0}
		<div class="empty-state">
			<p>No tags yet. Add #tag-name to any note to start categorizing.</p>
		</div>
	{:else}
		<section class="all-tags">
			<h2 class="section-title">All tags</h2>
			<ul class="tags-list">
				{#each allTags as { tag, count }, i (tag)}
					<li class="tag-row" class:focused={focusIndex === i}>
						{#if renamingTag === tag}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:value={renameValue}
								onkeydown={handleRenameKeydown}
								onblur={submitRename}
								class="rename-input"
								autofocus
							/>
							<button
								class="rename-btn save"
								onclick={submitRename}
								title="Save"
							>
								<Check class="h-4 w-4" />
							</button>
							<button class="rename-btn" onclick={cancelRename} title="Cancel">
								<X class="h-4 w-4" />
							</button>
						{:else}
							<a href="/read/tag/{tag}" class="tag-link">
								<span class="tag-name">#{tag}</span>
							</a>
							<span class="tag-count">{count} note{count === 1 ? '' : 's'}</span>
							<button class="rename-btn" onclick={() => startRename(tag)} title="Rename">
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
	.tags-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		text-align: center;
		margin-bottom: 2rem;
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

	.section-desc {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
		line-height: 1.5;
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
		font-family: ui-monospace, monospace;
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

	.low-value {
		margin-bottom: 2rem;
		padding: 1rem;
		background: color-mix(in srgb, #facc15 5%, var(--color-bg-secondary));
		border: 1px solid color-mix(in srgb, #facc15 30%, var(--color-border));
		border-radius: 0.75rem;
	}

	.low-value .section-title {
		color: #d97706;
	}

	.low-value-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.low-value-tag {
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		background: var(--color-bg);
		border-radius: 999px;
		color: var(--color-text-muted);
	}

	.all-tags {
		margin-top: 1rem;
	}

	.tags-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.5rem;
	}

	.tag-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}

	.tag-row:hover {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.tag-row.focused {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.tag-link {
		flex: 1;
		min-width: 0;
		text-decoration: none;
	}

	.tag-name {
		font-family: ui-monospace, monospace;
		color: var(--color-text);
		font-weight: 500;
		font-size: 0.875rem;
	}

	.tag-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.rename-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.rename-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.rename-btn.save:hover {
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
		font-family: ui-monospace, monospace;
		outline: none;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}
</style>
