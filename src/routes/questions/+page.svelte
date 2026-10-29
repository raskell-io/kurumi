<script lang="ts">
	import {
		questions,
		projects,
		memoryObjects,
		addQuestion,
		updateQuestion,
		deleteRecord,
		restoreRecord,
		recordInProject,
		type Question,
		type QuestionStatus
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { HelpCircle, CheckCircle2, CircleSlash, RotateCcw, Trash2, UserRound } from 'lucide-svelte';

	// Open questions until they're answered (or dropped). Meetings add their
	// unresolved questions here automatically.
	const TABS: { value: QuestionStatus; label: string }[] = [
		{ value: 'open', label: 'Open' },
		{ value: 'answered', label: 'Answered' },
		{ value: 'dropped', label: 'Dropped' }
	];
	let tab = $state<QuestionStatus>('open');
	let projectFilter = $state('');

	let shown = $derived($questions.filter((q) => q.status === tab && (!projectFilter || inFilteredProject(q))));
	let counts = $derived(Object.fromEntries(TABS.map((t) => [t.value, $questions.filter((q) => q.status === t.value).length])) as Record<QuestionStatus, number>);

	function inFilteredProject(rec: { projectId: string | null; memoryId: string | null }) {
		const project = $projects.find((p) => p.id === projectFilter);
		return !!project && recordInProject(rec, project);
	}
	// Project shown on a row: its own, or the one of the note it came from.
	let projectOf = (rec: { projectId: string | null; memoryId: string | null }) =>
		rec.projectId ? $projects.find((p) => p.id === rec.projectId) : $projects.find((p) => recordInProject(rec, p));

	let noteTitle = (id: string | null) => (id ? $memoryObjects.find((m) => m.id === id)?.title || 'Untitled' : undefined);

	// New question
	let text = $state('');
	let assignee = $state('');
	let newProject = $state('');

	function ask(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim()) return;
		addQuestion({ text, assignee: assignee.trim() || null, projectId: newProject || null });
		text = assignee = '';
	}

	// Answering / assigning inline
	let answering = $state<string | null>(null);
	let answerText = $state('');
	let assigning = $state<string | null>(null);
	let assignText = $state('');

	function answer(id: string) {
		updateQuestion(id, { status: 'answered', answer: answerText.trim() });
		answering = null;
	}

	function setStatus(q: Question, status: QuestionStatus) {
		const previous = q.status;
		updateQuestion(q.id, { status });
		if (status !== 'open') pushUndo({ label: status === 'dropped' ? 'Dropped question' : 'Answered question', undo: () => updateQuestion(q.id, { status: previous }) });
	}

	function remove(q: Question) {
		const snapshot = deleteRecord<Question>('questions', q.id);
		if (snapshot) pushUndo({ label: 'Deleted question', undo: () => restoreRecord('questions', snapshot) });
	}
</script>

<svelte:head>
	<title>Questions - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Open questions</h1>
			<p class="k-page-subtitle">Questions to get answered. Meetings add their unresolved ones here automatically.</p>
		</div>
	</header>

	<form class="k-card mb-5 grid gap-2 p-3" onsubmit={ask}>
		<input class="k-input" bind:value={text} placeholder="What needs answering?" aria-label="Question" />
		<div class="flex flex-wrap items-center gap-2">
			<input class="k-input !h-8 !w-44" bind:value={assignee} placeholder="Who should answer?" aria-label="Who should answer" />
			<select class="k-input !h-8 !w-auto !py-0" bind:value={newProject} aria-label="Project">
				<option value="">No project</option>
				{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<button class="k-btn k-btn-primary k-btn-sm ml-auto" disabled={!text.trim()}>Add question</button>
		</div>
	</form>

	<div class="mb-3 flex flex-wrap items-center gap-2">
		<div class="k-segmented" role="group" aria-label="Status">
			{#each TABS as t (t.value)}
				<button class="inline-flex items-center gap-1.5" aria-pressed={tab === t.value} onclick={() => (tab = t.value)}>
					{t.label}<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{counts[t.value]}</span>
				</button>
			{/each}
		</div>
		{#if $projects.length}
			<select class="k-input !h-8 !w-auto !py-0" bind:value={projectFilter} aria-label="Filter by project">
				<option value="">All projects</option>
				{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		{/if}
	</div>

	{#if shown.length === 0}
		<div class="k-empty">
			<HelpCircle />
			<p class="k-empty-title">{tab === 'open' ? 'No open questions' : 'Nothing here'}</p>
		</div>
	{:else}
		<ul>
			{#each shown as q (q.id)}
				<li class="k-row group !items-start">
					{#if q.status === 'answered'}<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />{:else}<HelpCircle class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />{/if}
					<div class="min-w-0 flex-1">
						<p class:line-through={q.status === 'dropped'}>{q.text}</p>
						{#if q.status === 'answered' && q.answer}<p class="text-[0.8125rem] text-[var(--color-text-muted)]">→ {q.answer}</p>{/if}
						{#if answering === q.id}
							<form class="mt-1.5 flex gap-1.5" onsubmit={(e) => { e.preventDefault(); answer(q.id); }}>
								<input class="k-input !h-8" bind:value={answerText} placeholder="The answer (optional)" aria-label="Answer" />
								<button class="k-btn k-btn-primary k-btn-sm">Save</button>
								<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => (answering = null)}>Cancel</button>
							</form>
						{/if}
						{#if assigning === q.id}
							<form class="mt-1.5 flex gap-1.5" onsubmit={(e) => { e.preventDefault(); updateQuestion(q.id, { assignee: assignText.trim() || null }); assigning = null; }}>
								<input class="k-input !h-8" bind:value={assignText} placeholder="Name" aria-label="Who should answer" />
								<button class="k-btn k-btn-primary k-btn-sm">Save</button>
							</form>
						{/if}
						<p class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--color-text-faint)]">
							{#if q.assignee}<span class="inline-flex items-center gap-1"><UserRound class="h-3 w-3" />{q.assignee}</span>{/if}
							{#if projectOf(q)}<a href="/projects/{projectOf(q)!.id}">{projectOf(q)!.name}</a>{/if}
							{#if noteTitle(q.memoryId)}<a href="/memory/{q.memoryId}">from {noteTitle(q.memoryId)}</a>{/if}
						</p>
					</div>
					<span class="row-actions flex shrink-0 gap-0.5">
						{#if q.status === 'open'}
							<button class="k-btn k-btn-ghost k-btn-sm" onclick={() => { answering = q.id; answerText = ''; }}>Answer</button>
							<button class="k-icon-btn" onclick={() => { assigning = q.id; assignText = q.assignee ?? ''; }} title="Assign" aria-label="Assign question"><UserRound class="h-3.5 w-3.5" /></button>
							<button class="k-icon-btn" onclick={() => setStatus(q, 'dropped')} title="Drop" aria-label="Drop question"><CircleSlash class="h-3.5 w-3.5" /></button>
						{:else}
							<button class="k-icon-btn" onclick={() => updateQuestion(q.id, { status: 'open' })} title="Reopen" aria-label="Reopen question"><RotateCcw class="h-3.5 w-3.5" /></button>
						{/if}
						<button class="k-icon-btn danger" onclick={() => remove(q)} title="Delete" aria-label="Delete question"><Trash2 class="h-3.5 w-3.5" /></button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
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
