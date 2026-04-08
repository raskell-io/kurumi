<script lang="ts">
	import {
		people,
		mergePeople,
		proposePersonMerges,
		deletePerson,
		getMemoryObjectsByPerson,
		type Person
	} from '$lib/db';
	import { Users, GitMerge, ArrowRight, Trash2, X } from 'lucide-svelte';

	// Recompute proposals whenever people change.
	let proposals = $derived.by(() => {
		// Reference $people to subscribe.
		void $people;
		return proposePersonMerges();
	});

	let mergeSource = $state<Person | null>(null);
	let mergeTarget = $state<Person | null>(null);
	let confirmingMerge = $state(false);

	function startMerge(source: Person, target: Person) {
		mergeSource = source;
		mergeTarget = target;
		confirmingMerge = true;
	}

	function cancelMerge() {
		mergeSource = null;
		mergeTarget = null;
		confirmingMerge = false;
	}

	function confirmMerge() {
		if (!mergeSource || !mergeTarget) return;
		mergePeople(mergeSource.id, mergeTarget.id);
		cancelMerge();
	}

	function handleDelete(person: Person) {
		if (confirm(`Delete ${person.name}? References in notes will be preserved as plain text.`)) {
			deletePerson(person.id);
		}
	}

	function refCount(person: Person): number {
		return getMemoryObjectsByPerson(person.name).length;
	}
</script>

<svelte:head>
	<title>People - Kurumi</title>
</svelte:head>

<main class="people-page">
	<header class="page-header">
		<div class="header-icon">
			<Users class="h-8 w-8" />
		</div>
		<h1>People</h1>
		<p class="count">{$people.length} {$people.length === 1 ? 'person' : 'people'}</p>
	</header>

	{#if proposals.length > 0}
		<section class="merge-suggestions">
			<h2 class="section-title">
				<GitMerge class="h-4 w-4" />
				Possible duplicates ({proposals.length})
			</h2>
			<ul class="proposal-list">
				{#each proposals as { source, target } (source.id + target.id)}
					<li class="proposal">
						<span class="proposal-source">{source.name}</span>
						<ArrowRight class="h-4 w-4 text-[var(--color-text-muted)]" />
						<span class="proposal-target">{target.name}</span>
						<button class="merge-btn" onclick={() => startMerge(source, target)}>
							Merge
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if $people.length === 0}
		<div class="empty-state">
			<p>No people yet. Mention @Someone in a note to create a person entry.</p>
		</div>
	{:else}
		<section class="all-people">
			<h2 class="section-title">All people</h2>
			<ul class="people-list">
				{#each $people as person (person.id)}
					<li class="person-row">
						<a href="/read/person/{person.name}" class="person-link">
							<span class="person-name">{person.name}</span>
							{#if person.title || person.company}
								<span class="person-meta">
									{person.title ?? ''}{person.title && person.company ? ' @ ' : ''}{person.company ?? ''}
								</span>
							{/if}
						</a>
						<span class="person-count">{refCount(person)} ref{refCount(person) === 1 ? '' : 's'}</span>
						<button class="row-btn" onclick={() => handleDelete(person)} title="Delete">
							<Trash2 class="h-4 w-4" />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

{#if confirmingMerge && mergeSource && mergeTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" onclick={cancelMerge} role="dialog" aria-modal="true" tabindex="-1">
		<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
			<div class="modal-header">
				<h3>Merge people</h3>
				<button class="close-btn" onclick={cancelMerge} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="modal-body">
				<p>
					This will rewrite every <code>@{mergeSource.name}</code> mention to
					<code>@{mergeTarget.name}</code> across all notes, action items, and
					participant lists. The original person entry will be deleted.
				</p>
				<p class="modal-summary">
					<strong>{mergeSource.name}</strong>
					<span class="count-pill">{refCount(mergeSource)} refs</span>
					<ArrowRight class="h-4 w-4 inline" />
					<strong>{mergeTarget.name}</strong>
					<span class="count-pill">{refCount(mergeTarget)} refs</span>
				</p>
				<p class="warning">This cannot be undone.</p>
			</div>
			<div class="modal-actions">
				<button class="btn-secondary" onclick={cancelMerge}>Cancel</button>
				<button class="btn-primary" onclick={confirmMerge}>
					<GitMerge class="h-4 w-4" />
					Merge
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.people-page {
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

	.proposal-source {
		font-weight: 500;
		color: var(--color-text);
	}

	.proposal-target {
		font-weight: 500;
		color: var(--color-text);
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

	.all-people {
		margin-top: 1rem;
	}

	.people-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.person-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		transition: border-color 0.15s;
	}

	.person-row:hover {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.person-link {
		flex: 1;
		min-width: 0;
		text-decoration: none;
		display: flex;
		flex-direction: column;
	}

	.person-name {
		color: var(--color-text);
		font-weight: 500;
	}

	.person-meta {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.person-count {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.row-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.row-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.modal {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 480px;
		width: 100%;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.modal-header h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.close-btn {
		background: none;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.modal-body {
		padding: 1.25rem;
		color: var(--color-text);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.modal-body p {
		margin: 0 0 1rem 0;
	}

	.modal-body p:last-child {
		margin-bottom: 0;
	}

	.modal-body code {
		background: var(--color-bg-secondary);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.8125rem;
	}

	.modal-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
	}

	.count-pill {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding: 0.125rem 0.5rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.warning {
		color: #ef4444;
		font-weight: 500;
	}

	.modal-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.btn-secondary,
	.btn-primary {
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		transition: all 0.15s;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover {
		background: var(--color-bg-secondary);
	}

	.btn-primary {
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		color: white;
	}

	.btn-primary:hover {
		background: var(--color-accent-hover);
	}
</style>
