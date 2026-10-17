<script lang="ts">
	import {
		people,
		mergePeople,
		restoreFromPeopleMergeSnapshot,
		proposePersonMerges,
		deletePerson,
		restorePerson,
		getMemoryObjectsByPerson,
		getAllPeople,
		addPerson,
		memoryObjects,
		type Person
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { Users, GitMerge, ArrowRight, Trash2, X, UserPlus } from 'lucide-svelte';

	const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

	// Recompute proposals whenever people change.
	let proposals = $derived.by(() => {
		// Reference $people to subscribe.
		void $people;
		return proposePersonMerges();
	});

	// People @mentioned in notes (or extracted from recordings) who don't
	// have a saved entry yet. Shown below the saved list with a one-click
	// Save, so nobody you've written about is missing from this page.
	let unsaved = $derived.by(() => {
		void $memoryObjects;
		const saved = new Set($people.map((p) => p.name.toLowerCase()));
		return getAllPeople()
			.filter((p) => !saved.has(p.name.toLowerCase()))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	});

	function saveAll() {
		const names = unsaved.map((p) => p.name);
		const created = names.map((name) => addPerson(name));
		pushUndo({
			label: `Saved ${created.length} ${created.length === 1 ? 'person' : 'people'}`,
			undo: () => created.forEach((person) => deletePerson(person.id))
		});
	}

	function savePerson(name: string) {
		const person = addPerson(name);
		pushUndo({ label: `Saved ${name}`, undo: () => deletePerson(person.id) });
	}

	let mergeSource = $state<Person | null>(null);
	let mergeTarget = $state<Person | null>(null);
	let confirmingMerge = $state(false);
	let mergeButton = $state<HTMLButtonElement | null>(null);

	async function startMerge(source: Person, target: Person) {
		mergeSource = source;
		mergeTarget = target;
		confirmingMerge = true;
		await tick();
		mergeButton?.focus();
	}

	function cancelMerge() {
		mergeSource = null;
		mergeTarget = null;
		confirmingMerge = false;
	}

	function confirmMerge() {
		if (!mergeSource || !mergeTarget) return;
		const sourceName = mergeSource.name;
		const targetName = mergeTarget.name;
		const snapshot = mergePeople(mergeSource.id, mergeTarget.id);
		if (snapshot) {
			pushUndo({
				label: `Merged ${sourceName} → ${targetName}`,
				undo: () => restoreFromPeopleMergeSnapshot(snapshot)
			});
		}
		cancelMerge();
	}

	// Deleting is undoable (Cmd+Z / undo toast), so no confirm prompt.
	// References in notes are preserved as plain text.
	function handleDelete(person: Person) {
		const snapshot: Person = { ...person };
		deletePerson(person.id);
		pushUndo({
			label: `Deleted ${person.name}`,
			undo: () => restorePerson(snapshot)
		});
	}

	function refCount(person: Person): number {
		return getMemoryObjectsByPerson(person.name).length;
	}

	// Keyboard navigation: j/k moves focus, Enter jumps to the person
	// read filter, d deletes, Escape unfocuses. No rename here because
	// the people page doesn't have inline rename (people are edited
	// via the memory @mention flow).
	let focusIndex = $state(-1);

	$effect(() => {
		if (focusIndex < 0) return;
		document
			.querySelector(`[data-row-index="${focusIndex}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});

	function handlePageKeydown(e: KeyboardEvent) {
		if (confirmingMerge) {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancelMerge();
			}
			return;
		}
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}
		// Leave global shortcuts (Cmd+K, Cmd+D, ...) alone.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if ($people.length === 0) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusIndex = Math.min($people.length - 1, focusIndex < 0 ? 0 : focusIndex + 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusIndex = Math.max(0, focusIndex < 0 ? 0 : focusIndex - 1);
				break;
			case 'Enter': {
				// A focused button/link handles its own Enter.
				if (target.tagName === 'BUTTON' || target.tagName === 'A') break;
				const person = $people[focusIndex];
				if (person) goto(`/read/person/${encodeURIComponent(person.name)}`);
				break;
			}
			case 'Delete':
			case 'd':
			case 'D': {
				e.preventDefault();
				const person = $people[focusIndex];
				if (person) {
					const lastIndex = $people.length - 2;
					handleDelete(person);
					focusIndex = Math.min(focusIndex, lastIndex);
				}
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
</script>

<svelte:head>
	<title>People - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">People</h1>
			<p class="k-page-subtitle">
				{#if $people.length === 0}
					{unsaved.length} {unsaved.length === 1 ? 'person' : 'people'} mentioned in your notes
				{:else if unsaved.length === 0}
					{$people.length} {$people.length === 1 ? 'person' : 'people'}
				{:else}
					{$people.length} saved · {unsaved.length} more mentioned
				{/if}
			</p>
			{#if $people.length > 0}
				<div class="k-hints">
					<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
					<span><kbd class="k-kbd">↵</kbd> open</span>
					<span><kbd class="k-kbd">d</kbd> delete</span>
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
				{#each proposals as { source, target } (source.id + target.id)}
					<li class="k-row">
						<span class="min-w-0 truncate">{source.name}</span>
						<ArrowRight class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
						<span class="min-w-0 flex-1 truncate font-medium">{target.name}</span>
						<button class="k-btn k-btn-primary k-btn-sm" onclick={() => startMerge(source, target)}>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if $people.length === 0 && unsaved.length === 0}
		<div class="k-empty">
			<Users />
			<p class="k-empty-title">No people yet</p>
			<p>Type @ and a name in any note — they'll appear here.</p>
		</div>
	{:else if $people.length > 0}
		<section>
			{#if proposals.length > 0}
				<h2 class="k-section-title">All people</h2>
			{/if}
			<ul>
				{#each $people as person, i (person.id)}
					{@const refs = refCount(person)}
					<li class="k-row group" class:focused={focusIndex === i} data-row-index={i}>
						<a href="/read/person/{encodeURIComponent(person.name)}" class="flex min-w-0 flex-1 items-baseline gap-2">
							<span class="truncate">{person.name}</span>
							{#if person.title || person.company}
								<span class="truncate text-xs text-[var(--color-text-faint)]">
									{person.title ?? ''}{person.title && person.company ? ' @ ' : ''}{person.company ?? ''}
								</span>
							{/if}
						</a>
						<span class="k-badge" title="{refs} reference{refs === 1 ? '' : 's'}">{refs}</span>
						<button
							class="k-icon-btn row-action hover:!text-[var(--color-danger)]"
							onclick={() => handleDelete(person)}
							aria-label="Delete {person.name}"
							title="Delete"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if unsaved.length > 0}
		<section>
			<h2 class="k-section-title" class:!mt-0={$people.length === 0 && proposals.length === 0}>
				<span class="flex-1">Mentioned in notes</span>
				{#if unsaved.length > 1}
					<button class="k-btn k-btn-ghost k-btn-sm" onclick={saveAll}>Save all</button>
				{/if}
			</h2>
			<ul>
				{#each unsaved as mention (mention.name)}
					<li class="k-row group">
						<a href="/read/person/{encodeURIComponent(mention.name)}" class="min-w-0 flex-1 truncate">
							{mention.name}
						</a>
						<span class="k-badge" title="{mention.count} mention{mention.count === 1 ? '' : 's'}">{mention.count}</span>
						<button class="k-btn k-btn-ghost k-btn-sm" onclick={() => savePerson(mention.name)} title="Save as a person to add details and merge duplicates">
							<UserPlus class="h-3.5 w-3.5" />
							Save
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

{#if confirmingMerge && mergeSource && mergeTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="k-dialog-backdrop" onclick={cancelMerge}>
		<div
			class="k-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="merge-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between px-5 pt-4">
				<h3 id="merge-title" class="text-[0.9375rem] font-semibold text-[var(--color-text)]">Merge people</h3>
				<button class="k-icon-btn" onclick={cancelMerge} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="space-y-3 px-5 py-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
				<div class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] px-3 py-2.5 text-[var(--color-text)]">
					<span class="font-medium">{mergeSource.name}</span>
					<span class="k-badge">{refCount(mergeSource)} refs</span>
					<ArrowRight class="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
					<span class="font-medium">{mergeTarget.name}</span>
					<span class="k-badge">{refCount(mergeTarget)} refs</span>
				</div>
				<p>
					Every <code>@{mergeSource.name}</code> mention becomes
					<code>@{mergeTarget.name}</code> across notes, action items and
					participant lists, and the {mergeSource.name} entry is removed.
					You can undo this right after with {modKey}Z.
				</p>
			</div>
			<div class="flex justify-end gap-2 px-5 pt-1 pb-4">
				<button class="k-btn k-btn-ghost" onclick={cancelMerge}>Cancel</button>
				<button class="k-btn k-btn-primary" bind:this={mergeButton} onclick={confirmMerge}>
					<GitMerge class="h-4 w-4" />
					Merge
				</button>
			</div>
		</div>
	</div>
{/if}

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

	code {
		padding: 0.0625rem 0.3125rem;
		border-radius: var(--radius-sm);
		background: var(--color-hover);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text);
	}
</style>
