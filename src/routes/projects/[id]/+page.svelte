<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		projects,
		memoryObjects,
		actionItems,
		questions,
		decisions,
		meetingSeries,
		updateProject,
		deleteProject,
		restoreProject,
		actionItemInProject,
		recordInProject,
		addActionItem,
		updateActionItemStatus,
		completeRecurring,
		addQuestion,
		updateQuestion,
		addDecision,
		addMemoryObject,
		setMemoryInProject,
		todayIso,
		type ActionItem,
		type ProjectStatus
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { dueInfo } from '$lib/utils/due';
	import { sortOpenActionItems } from '$lib/todos';
	import { myNames, isWaitingFor } from '$lib/work';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import NoteIcon from '$lib/components/NoteIcon.svelte';
	import { ChevronLeft, Square, Check, Trash2, Users, Plus, HelpCircle, Gavel, ListTodo, NotebookText, CalendarClock } from 'lucide-svelte';

	const STATUSES: { value: ProjectStatus; label: string }[] = [
		{ value: 'active', label: 'Active' },
		{ value: 'paused', label: 'Paused' },
		{ value: 'done', label: 'Done' },
		{ value: 'archived', label: 'Archived' }
	];
	const today = todayIso();
	const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

	let project = $derived($projects.find((p) => p.id === $page.params.id));

	let todos = $derived(project ? sortOpenActionItems($actionItems.filter((a) => actionItemInProject(a, project!)), today) : []);
	let openQuestions = $derived(project ? $questions.filter((q) => q.status === 'open' && recordInProject(q, project!)) : []);
	let resolvedQuestions = $derived(project ? $questions.filter((q) => q.status !== 'open' && recordInProject(q, project!)) : []);
	let projectDecisions = $derived(project ? $decisions.filter((d) => recordInProject(d, project!)) : []);
	let series = $derived(project ? $meetingSeries.filter((m) => m.projectId === project!.id) : []);
	let notes = $derived(
		project
			? $memoryObjects.filter((m) => m.projects?.some((n) => sameName(n, project!.name))).sort((a, b) => b.updatedAt - a.updatedAt)
			: []
	);
	let noteTitle = (id: string | null) => (id ? $memoryObjects.find((m) => m.id === id)?.title || 'Untitled' : null);

	let answering = $state<string | null>(null);
	let answerText = $state('');

	function complete(item: ActionItem) {
		const previous = item.status;
		if (item.recurrence !== 'none') completeRecurring(item.id);
		else updateActionItemStatus(item.id, 'done');
		pushUndo({ label: `Completed “${item.text}”`, undo: () => updateActionItemStatus(item.id, previous) });
	}

	function saveAnswer(id: string) {
		updateQuestion(id, { status: 'answered', answer: answerText.trim() });
		answering = null;
		answerText = '';
	}

	function newNote() {
		if (!project) return;
		const memory = addMemoryObject(undefined, undefined, null);
		setMemoryInProject(memory.id, project.name, true);
		goto(`/memory/${memory.id}`);
	}

	function remove() {
		if (!project) return;
		const snapshot = deleteProject(project.id);
		if (snapshot) pushUndo({ label: `Deleted project “${snapshot.name}”`, undo: () => restoreProject(snapshot) });
		goto('/projects');
	}

	// Inline edits save on change; the name only when non-empty.
	function rename(value: string) {
		if (project && value.trim() && value.trim() !== project.name) updateProject(project.id, { name: value.trim() });
	}
</script>

<svelte:head>
	<title>{project?.name ?? 'Project'} - Kurumi</title>
</svelte:head>

<div class="k-page">
	<a href="/projects" class="mb-3 inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text)]">
		<ChevronLeft class="h-4 w-4" /> Projects
	</a>

	{#if !project}
		<div class="k-empty"><p class="k-empty-title">Project not found</p><p>It may have been deleted or is in another vault.</p></div>
	{:else}
		<input
			class="project-title"
			value={project.name}
			aria-label="Project name"
			onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
		/>

		<div class="project-props">
			<label>
				<span>Status</span>
				<select class="k-input !h-8 !py-0" value={project.status} onchange={(e) => updateProject(project!.id, { status: (e.currentTarget as HTMLSelectElement).value as ProjectStatus })}>
					{#each STATUSES as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
				</select>
			</label>
			<label>
				<span>Owner</span>
				<input class="k-input !h-8" placeholder="Nobody yet" value={project.owner ?? ''} onchange={(e) => updateProject(project!.id, { owner: (e.currentTarget as HTMLInputElement).value.trim() || null })} />
			</label>
			<label>
				<span>Due</span>
				<input type="date" class="k-input !h-8" value={project.dueDate ?? ''} onchange={(e) => updateProject(project!.id, { dueDate: (e.currentTarget as HTMLInputElement).value || null })} />
			</label>
		</div>

		<textarea
			class="project-description"
			rows="2"
			placeholder="What is this project about? Goal, scope, links…"
			value={project.description}
			onchange={(e) => updateProject(project!.id, { description: (e.currentTarget as HTMLTextAreaElement).value })}
		></textarea>

		<!-- To-dos -->
		<h2 class="k-section-title"><ListTodo class="h-3.5 w-3.5" /> To-dos <span class="font-normal tabular-nums">{todos.length}</span></h2>
		<div class="k-card p-1">
			{#each todos as item (item.id)}
				{@const due = item.dueDate ? dueInfo(item.dueDate, true, today) : null}
				<div class="k-row">
					<button class="check" onclick={() => complete(item)} aria-label="Mark “{item.text}” done"><Square class="h-4 w-4" /></button>
					<span class="min-w-0 flex-1 truncate">{item.text}</span>
					{#if isWaitingFor(item, $myNames)}<span class="k-badge" title="Waiting for {item.assignee}">Waiting · {item.assignee}</span>{:else if item.assignee}<span class="k-badge">{item.assignee}</span>{/if}
					{#if due}<span class="shrink-0 text-xs" class:text-[var(--color-danger)]={due.tone === 'danger'} class:text-[var(--color-text-faint)]={due.tone !== 'danger'}>{due.label}</span>{/if}
				</div>
			{/each}
			<QuickAdd placeholder="Add a to-do (assign with “@Name”)…" onAdd={(text) => {
				const at = text.match(/\s@([\w.-]+(?:\s[\w.-]+)?)$/);
				addActionItem({ text: at ? text.slice(0, at.index).trim() : text, assignee: at?.[1] ?? null, projectId: project!.id });
			}} />
		</div>

		<!-- Open questions -->
		<h2 class="k-section-title"><HelpCircle class="h-3.5 w-3.5" /> Open questions <span class="font-normal tabular-nums">{openQuestions.length}</span></h2>
		<div class="k-card p-1">
			{#each openQuestions as q (q.id)}
				<div class="k-row !items-start">
					<HelpCircle class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
					<div class="min-w-0 flex-1">
						<p>{q.text}</p>
						{#if answering === q.id}
							<form class="mt-1.5 flex gap-1.5" onsubmit={(e) => { e.preventDefault(); saveAnswer(q.id); }}>
								<input class="k-input !h-8" bind:value={answerText} placeholder="The answer…" aria-label="Answer" />
								<button class="k-btn k-btn-sm k-btn-primary">Save</button>
							</form>
						{/if}
						{#if q.memoryId}<a href="/memory/{q.memoryId}" class="text-xs text-[var(--color-text-faint)]">from {noteTitle(q.memoryId)}</a>{/if}
					</div>
					{#if answering !== q.id}
						<button class="k-btn k-btn-ghost k-btn-sm" onclick={() => { answering = q.id; answerText = ''; }}>Answer</button>
					{/if}
				</div>
			{/each}
			<QuickAdd placeholder="Add an open question…" onAdd={(text) => addQuestion({ text, projectId: project!.id })} />
			{#if resolvedQuestions.length}
				<a href="/questions" class="block px-3 py-1.5 text-xs text-[var(--color-text-faint)]">{resolvedQuestions.length} answered or dropped →</a>
			{/if}
		</div>

		<!-- Decisions -->
		<h2 class="k-section-title"><Gavel class="h-3.5 w-3.5" /> Decisions <span class="font-normal tabular-nums">{projectDecisions.length}</span></h2>
		<div class="k-card p-1">
			{#each projectDecisions as d (d.id)}
				<div class="k-row !items-start">
					<Check class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
					<div class="min-w-0 flex-1">
						<p>{d.text}</p>
						<p class="text-xs text-[var(--color-text-faint)]">
							{d.decidedOn}{#if d.decidedBy.length} · {d.decidedBy.join(', ')}{/if}{#if d.memoryId} · <a href="/memory/{d.memoryId}">{noteTitle(d.memoryId)}</a>{/if}
						</p>
					</div>
				</div>
			{/each}
			<QuickAdd placeholder="Log a decision…" onAdd={(text) => addDecision({ text, projectId: project!.id })} />
		</div>

		<!-- Meetings -->
		<h2 class="k-section-title"><Users class="h-3.5 w-3.5" /> Recurring meetings</h2>
		<div class="k-card p-1">
			{#each series as m (m.id)}
				<a href="/meetings/{m.id}" class="k-row">
					<CalendarClock class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
					<span class="min-w-0 flex-1 truncate">{m.name}</span>
					<span class="text-xs text-[var(--color-text-faint)]">{m.agenda.filter((a) => !a.meetingId).length} on the agenda</span>
				</a>
			{/each}
			<a href="/meetings?project={project.id}" class="k-row text-[var(--color-text-muted)]"><Plus class="h-4 w-4" /> New recurring meeting</a>
		</div>

		<!-- Notes -->
		<h2 class="k-section-title"><NotebookText class="h-3.5 w-3.5" /> Notes <span class="font-normal tabular-nums">{notes.length}</span></h2>
		<div class="k-card p-1">
			{#each notes.slice(0, 30) as note (note.id)}
				<a href="/memory/{note.id}" class="k-row">
					<NoteIcon icon={note.icon} class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
					<span class="text-xs text-[var(--color-text-faint)]">{new Date(note.updatedAt).toLocaleDateString()}</span>
				</a>
			{/each}
			<button class="k-row w-full text-left text-[var(--color-text-muted)]" onclick={newNote}><Plus class="h-4 w-4" /> New note in this project</button>
			<p class="px-3 pb-2 text-xs text-[var(--color-text-faint)]">Add an existing note from its page: the project chip under the title.</p>
		</div>

		<div class="mt-10 border-t border-[var(--color-border)] pt-4">
			<button class="k-btn k-btn-ghost k-btn-sm !text-[var(--color-danger)]" onclick={remove}>
				<Trash2 class="h-3.5 w-3.5" /> Delete project
			</button>
			<span class="ml-2 text-xs text-[var(--color-text-faint)]">Its notes, to-dos, decisions and questions are kept.</span>
		</div>
	{/if}
</div>

<style>
	.project-title,
	.project-title:focus,
	.project-title:focus-visible {
		width: 100%;
		border: none !important;
		background: transparent;
		color: var(--color-text);
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.015em;
		outline: none !important;
		box-shadow: none !important;
	}

	.project-props {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		margin: 0.75rem 0;
	}

	.project-props label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.project-props label :global(.k-input) {
		width: auto;
		min-width: 8rem;
	}

	.project-description {
		width: 100%;
		resize: vertical;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		padding: 0.375rem 0.5rem;
		margin-left: -0.5rem;
		font-size: 0.9375rem;
		line-height: 1.5;
		color: var(--color-text);
	}

	.project-description:hover,
	.project-description:focus {
		border-color: var(--color-border);
		outline: none;
	}

	.check {
		display: flex;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.check:hover {
		color: var(--color-accent);
	}
</style>
