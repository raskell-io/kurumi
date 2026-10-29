<script lang="ts">
	import {
		decisions,
		projects,
		memoryObjects,
		addDecision,
		updateDecision,
		deleteRecord,
		restoreRecord,
		recordInProject,
		todayIso,
		type Decision
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { Gavel, Pencil, Trash2, Search } from 'lucide-svelte';

	// The decision log: what was decided, when, by whom, and where.
	let projectFilter = $state('');
	let query = $state('');

	let shown = $derived(
		$decisions.filter(
			(d) =>
				(!projectFilter || inFilteredProject(d)) &&
				(!query.trim() || `${d.text} ${d.rationale} ${d.decidedBy.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);
	// Grouped by month, newest first.
	let months = $derived.by(() => {
		const groups = new Map<string, Decision[]>();
		for (const d of shown) {
			const key = d.decidedOn.slice(0, 7);
			groups.set(key, [...(groups.get(key) ?? []), d]);
		}
		return [...groups.entries()].map(([key, items]) => ({
			label: new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
			items
		}));
	});

	function inFilteredProject(rec: { projectId: string | null; memoryId: string | null }) {
		const project = $projects.find((p) => p.id === projectFilter);
		return !!project && recordInProject(rec, project);
	}
	// Project shown on a row: its own, or the one of the note it came from.
	let projectOf = (rec: { projectId: string | null; memoryId: string | null }) =>
		rec.projectId ? $projects.find((p) => p.id === rec.projectId) : $projects.find((p) => recordInProject(rec, p));

	let noteTitle = (id: string | null) => (id ? $memoryObjects.find((m) => m.id === id)?.title || 'Untitled' : undefined);

	// New decision form
	let text = $state('');
	let rationale = $state('');
	let decidedOn = $state(todayIso());
	let newProject = $state('');

	function log(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim()) return;
		addDecision({ text, rationale: rationale.trim(), decidedOn, projectId: newProject || null });
		text = rationale = '';
	}

	// Inline edit
	let editing = $state<string | null>(null);
	let editText = $state('');
	let editRationale = $state('');

	function startEdit(d: Decision) {
		editing = d.id;
		editText = d.text;
		editRationale = d.rationale;
	}

	function saveEdit(id: string) {
		if (editText.trim()) updateDecision(id, { text: editText.trim(), rationale: editRationale.trim() });
		editing = null;
	}

	function remove(d: Decision) {
		const snapshot = deleteRecord<Decision>('decisions', d.id);
		if (snapshot) pushUndo({ label: 'Deleted decision', undo: () => restoreRecord('decisions', snapshot) });
	}
</script>

<svelte:head>
	<title>Decisions - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Decisions</h1>
			<p class="k-page-subtitle">What was decided, when and why. Meetings add theirs here automatically.</p>
		</div>
	</header>

	<form class="k-card mb-5 grid gap-2 p-3" onsubmit={log}>
		<input class="k-input" bind:value={text} placeholder="What was decided?" aria-label="Decision" />
		<input class="k-input" bind:value={rationale} placeholder="Why? (optional)" aria-label="Rationale" />
		<div class="flex flex-wrap items-center gap-2">
			<input type="date" class="k-input !h-8 !w-auto" bind:value={decidedOn} aria-label="Decided on" />
			<select class="k-input !h-8 !w-auto !py-0" bind:value={newProject} aria-label="Project">
				<option value="">No project</option>
				{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<button class="k-btn k-btn-primary k-btn-sm ml-auto" disabled={!text.trim()}>Log decision</button>
		</div>
	</form>

	{#if $decisions.length > 0}
		<div class="mb-2 flex flex-wrap items-center gap-2">
			<label class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] px-2.5">
				<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
				<input class="search" bind:value={query} placeholder="Search decisions" aria-label="Search decisions" />
			</label>
			{#if $projects.length}
				<select class="k-input !h-8 !w-auto !py-0" bind:value={projectFilter} aria-label="Filter by project">
					<option value="">All projects</option>
					{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			{/if}
		</div>
	{/if}

	{#each months as month (month.label)}
		<h2 class="k-section-title">{month.label}</h2>
		<ul>
			{#each month.items as d (d.id)}
				<li class="k-row group !items-start">
					<Gavel class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
					<div class="min-w-0 flex-1">
						{#if editing === d.id}
							<form class="grid gap-1.5" onsubmit={(e) => { e.preventDefault(); saveEdit(d.id); }}>
								<input class="k-input !h-8" bind:value={editText} aria-label="Decision" />
								<input class="k-input !h-8" bind:value={editRationale} placeholder="Why?" aria-label="Rationale" />
								<div class="flex gap-1.5">
									<button class="k-btn k-btn-primary k-btn-sm">Save</button>
									<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => (editing = null)}>Cancel</button>
								</div>
							</form>
						{:else}
							<p>{d.text}</p>
							{#if d.rationale}<p class="text-[0.8125rem] text-[var(--color-text-muted)]">{d.rationale}</p>{/if}
							<p class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--color-text-faint)]">
								<span>{d.decidedOn}</span>
								{#if d.decidedBy.length}<span>{d.decidedBy.join(', ')}</span>{/if}
								{#if projectOf(d)}<a href="/projects/{projectOf(d)!.id}">{projectOf(d)!.name}</a>{/if}
								{#if noteTitle(d.memoryId)}<a href="/memory/{d.memoryId}">from {noteTitle(d.memoryId)}</a>{/if}
							</p>
						{/if}
					</div>
					{#if editing !== d.id}
						<span class="row-actions flex gap-0.5">
							<button class="k-icon-btn" onclick={() => startEdit(d)} aria-label="Edit decision"><Pencil class="h-3.5 w-3.5" /></button>
							<button class="k-icon-btn danger" onclick={() => remove(d)} aria-label="Delete decision"><Trash2 class="h-3.5 w-3.5" /></button>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		{#if $decisions.length === 0}
			<div class="k-empty">
				<Gavel />
				<p class="k-empty-title">No decisions yet</p>
				<p>Log one above, or record a meeting: its decisions land here.</p>
			</div>
		{:else}
			<div class="k-empty"><p class="k-empty-title">No matches</p></div>
		{/if}
	{/each}
</div>

<style>
	.search,
	.search:focus {
		min-width: 0;
		flex: 1;
		height: 2rem;
		border: none !important;
		background: transparent;
		font-size: 0.875rem;
		color: var(--color-text);
		outline: none !important;
		box-shadow: none !important;
	}

	.row-actions {
		opacity: 0;
	}

	.group:hover .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}

	@media (hover: none) {
		.row-actions {
			opacity: 1;
		}
	}
</style>
