<script lang="ts">
	import { workflows, addWorkflow, updateWorkflow, deleteWorkflow, restoreWorkflow, getMemoryObject, type Workflow, type WorkflowSchedule } from '$lib/db';
	import {
		runWorkflow,
		isRunning,
		scheduleLabel,
		nextRunAfter,
		hasAgentKey,
		workflowsRunHere,
		setWorkflowsRunHere,
		WEEKDAYS,
		WORKFLOW_EXAMPLES
	} from '$lib/workflows';
	import { pushUndo } from '$lib/stores/undo';
	import { Workflow as WorkflowIcon, Play, Pencil, Trash2, Plus, CircleCheck, CircleAlert, Loader2 } from 'lucide-svelte';

	type Draft = { name: string; instructions: string; schedule: WorkflowSchedule; output: 'note' | 'none'; notify: boolean };
	const blank = (): Draft => ({ name: '', instructions: '', schedule: { kind: 'weekly', time: '09:00', weekday: 1 }, output: 'note', notify: false });

	let editingId = $state<string | null>(null); // 'new' for the create form
	let draft = $state<Draft>(blank());
	let runHere = $state(typeof localStorage === 'undefined' ? true : workflowsRunHere());
	let keyed = $state(typeof localStorage === 'undefined' ? false : hasAgentKey());
	// Bumped when a run finishes, so "Running…" and the log refresh.
	let tick = $state(0);
	let expanded = $state<string | null>(null);

	function startNew(example?: (typeof WORKFLOW_EXAMPLES)[number]) {
		draft = example ? { ...blank(), name: example.name, instructions: example.instructions, schedule: { ...example.schedule } } : blank();
		editingId = 'new';
	}

	function startEdit(w: Workflow) {
		draft = { name: w.name, instructions: w.instructions, schedule: { ...w.schedule }, output: w.output, notify: w.notify };
		editingId = w.id;
	}

	function save() {
		const name = draft.name.trim() || 'Untitled workflow';
		const instructions = draft.instructions.trim();
		if (!instructions) return;
		const value = { name, instructions, schedule: { ...draft.schedule }, output: draft.output, notify: draft.notify };
		if (editingId === 'new') addWorkflow(value);
		else if (editingId) updateWorkflow(editingId, value);
		editingId = null;
	}

	function remove(w: Workflow) {
		const removed = deleteWorkflow(w.id);
		if (removed) pushUndo({ label: `Deleted “${w.name}”`, undo: () => restoreWorkflow(removed) });
	}

	async function run(w: Workflow) {
		tick++;
		const result = runWorkflow(w);
		tick++;
		await result;
		tick++;
		expanded = w.id;
	}

	async function askNotifications() {
		if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
	}

	const when = (ts: number) =>
		new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head>
	<title>Workflows - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<main class="k-page">
		<header class="k-page-header">
			<div class="min-w-0">
				<h1 class="k-page-title">Workflows</h1>
				<p class="k-page-subtitle">Instructions the assistant carries out on a schedule, and writes up as a note.</p>
			</div>
			{#if editingId === null}
				<button type="button" class="k-btn k-btn-primary k-btn-sm" onclick={() => startNew()}><Plus class="h-3.5 w-3.5" /> New workflow</button>
			{/if}
		</header>

		{#if !keyed}
			<p class="notice">Workflows use the agent, which needs an OpenAI API key (Settings → AI assistant).</p>
		{/if}
		<label class="run-here">
			<input type="checkbox" bind:checked={runHere} onchange={() => setWorkflowsRunHere(runHere)} />
			Run scheduled workflows on this device <span class="hint">(they run while Kurumi is open; a run missed while it was closed happens at the next start)</span>
		</label>

		{#if editingId !== null}
			<form class="editor" onsubmit={(e) => { e.preventDefault(); save(); }}>
				<input class="k-input" bind:value={draft.name} placeholder="Name, e.g. Monday planning" aria-label="Workflow name" />
				<textarea class="k-input instructions" bind:value={draft.instructions} rows="5" aria-label="Instructions" placeholder="What should it do? e.g. Look at last week's meetings, propose the to-dos that came out of them, and summarise where each project stands."></textarea>
				<div class="row">
					<select class="k-input" bind:value={draft.schedule.kind} aria-label="How often">
						<option value="manual">Only when I run it</option>
						<option value="daily">Every day</option>
						<option value="weekly">Every week</option>
						<option value="monthly">Every month</option>
					</select>
					{#if draft.schedule.kind === 'weekly'}
						<select class="k-input" bind:value={draft.schedule.weekday} aria-label="Day of the week">
							{#each WEEKDAYS as day, i (day)}<option value={i}>{day}</option>{/each}
						</select>
					{:else if draft.schedule.kind === 'monthly'}
						<input class="k-input day" type="number" min="1" max="31" bind:value={draft.schedule.day} aria-label="Day of the month" />
					{/if}
					{#if draft.schedule.kind !== 'manual'}
						<input class="k-input time" type="time" bind:value={draft.schedule.time} aria-label="Time" />
					{/if}
				</div>
				<label class="check"><input type="checkbox" checked={draft.output === 'note'} onchange={(e) => (draft.output = (e.target as HTMLInputElement).checked ? 'note' : 'none')} /> Save the result as a note</label>
				<label class="check"><input type="checkbox" bind:checked={draft.notify} onchange={askNotifications} /> Notify me when it ran</label>
				<p class="hint">It can read your notes, to-dos, people and projects, and propose to-dos for you to approve. It can't change anything.</p>
				<div class="row end">
					<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => (editingId = null)}>Cancel</button>
					<button class="k-btn k-btn-primary k-btn-sm" disabled={!draft.instructions.trim()}>{editingId === 'new' ? 'Create' : 'Save'}</button>
				</div>
			</form>
		{/if}

		{#if $workflows.length === 0 && editingId === null}
			<div class="k-empty">
				<WorkflowIcon />
				<p class="k-empty-title">No workflows yet</p>
				<p>Start from one of these, or write your own:</p>
				<div class="examples">
					{#each WORKFLOW_EXAMPLES as example (example.name)}
						<button type="button" class="k-btn k-btn-sm" onclick={() => startNew(example)}>{example.name}</button>
					{/each}
				</div>
			</div>
		{/if}

		<ul class="list">
			{#each $workflows as w (w.id)}
				{@const busy = (void tick, isRunning(w.id))}
				{@const last = w.runs[0]}
				{@const next = w.enabled ? nextRunAfter(w.schedule, w.lastRunAt ?? w.createdAt) : null}
				<li class="workflow" class:off={!w.enabled}>
					<div class="head">
						<div class="min-w-0 flex-1">
							<p class="name">{w.name}</p>
							<p class="meta">
								{scheduleLabel(w.schedule)}{w.enabled ? '' : ' · paused'}
								{#if next} · next {when(next)}{/if}
							</p>
						</div>
						<button type="button" class="k-btn k-btn-sm" onclick={() => run(w)} disabled={busy || !keyed} data-testid="run-workflow">
							{#if busy}<Loader2 class="h-3.5 w-3.5 animate-spin" /> Running…{:else}<Play class="h-3.5 w-3.5" /> Run now{/if}
						</button>
						<input type="checkbox" class="switch-lite" checked={w.enabled} onchange={(e) => updateWorkflow(w.id, { enabled: (e.target as HTMLInputElement).checked })} aria-label="Scheduled" title="Run on its schedule" />
						<button type="button" class="k-icon-btn" onclick={() => startEdit(w)} aria-label="Edit workflow" title="Edit"><Pencil class="h-3.5 w-3.5" /></button>
						<button type="button" class="k-icon-btn danger" onclick={() => remove(w)} aria-label="Delete workflow" title="Delete"><Trash2 class="h-3.5 w-3.5" /></button>
					</div>
					<p class="instructions-preview">{w.instructions}</p>
					{#if last}
						<button type="button" class="last" onclick={() => (expanded = expanded === w.id ? null : w.id)} aria-expanded={expanded === w.id}>
							{#if last.status === 'ok'}<CircleCheck class="h-3.5 w-3.5 text-[var(--color-accent)]" />{:else}<CircleAlert class="h-3.5 w-3.5 text-[var(--color-danger)]" />{/if}
							Last run {when(last.at)} · {w.runs.length} run{w.runs.length === 1 ? '' : 's'} logged
						</button>
						{#if expanded === w.id}
							<ol class="log">
								{#each w.runs as r (r.at)}
									<li class:error={r.status === 'error'}>
										<span class="at">{when(r.at)}</span>
										<span class="summary">{r.summary || (r.status === 'ok' ? 'Done' : 'Failed')}</span>
										{#if r.tools.length}<span class="tools">used {r.tools.join(', ')}</span>{/if}
										{#if r.noteId && getMemoryObject(r.noteId)}<a href="/memory/{r.noteId}">Open note</a>{/if}
									</li>
								{/each}
							</ol>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	</main>
</div>

<style>
	.notice {
		margin-bottom: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.run-here,
	.check {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.run-here {
		margin-bottom: 1rem;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.instructions {
		height: auto;
		min-height: 6rem;
		padding: 0.5rem 0.625rem;
		line-height: 1.5;
		resize: vertical;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.row > .k-input {
		width: auto;
	}

	.row .day {
		width: 5rem;
	}

	.row.end {
		justify-content: flex-end;
	}

	.examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.workflow {
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.workflow.off {
		opacity: 0.7;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.name {
		font-weight: 600;
		color: var(--color-text);
	}

	.meta {
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.instructions-preview {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.last {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.log {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.5rem;
		padding-left: 1.25rem;
		font-size: 0.75rem;
		list-style: none;
	}

	.log li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		color: var(--color-text-muted);
	}

	.log li.error .summary {
		color: var(--color-danger);
	}

	.log .at,
	.log .tools {
		color: var(--color-text-faint);
	}

	.log .summary {
		flex: 1 1 100%;
		color: var(--color-text);
	}

	.log a {
		color: var(--color-accent);
	}

	.switch-lite {
		accent-color: var(--color-accent);
	}
</style>
