<script lang="ts">
	import {
		projects,
		memoryObjects,
		actionItems,
		questions,
		decisions,
		addProject,
		actionItemInProject,
		recordInProject,
		todayIso,
		type Project,
		type ProjectStatus
	} from '$lib/db';
	import { dueInfo } from '$lib/utils/due';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import { goto } from '$app/navigation';
	import { FolderKanban, Sparkles, X } from 'lucide-svelte';

	type Tab = 'active' | 'done' | 'archived';
	const TABS: { value: Tab; label: string; statuses: ProjectStatus[] }[] = [
		{ value: 'active', label: 'Active', statuses: ['active', 'paused'] },
		{ value: 'done', label: 'Done', statuses: ['done'] },
		{ value: 'archived', label: 'Archived', statuses: ['archived'] }
	];
	let tab = $state<Tab>('active');
	const today = todayIso();

	let shown = $derived($projects.filter((p) => TABS.find((t) => t.value === tab)!.statuses.includes(p.status)));
	let counts = $derived(
		Object.fromEntries(TABS.map((t) => [t.value, $projects.filter((p) => t.statuses.includes(p.status)).length])) as Record<Tab, number>
	);

	const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

	function stats(project: Project) {
		return {
			todos: $actionItems.filter((a) => (a.status === 'open' || a.status === 'in_progress') && actionItemInProject(a, project)).length,
			notes: $memoryObjects.filter((m) => m.projects?.some((n) => sameName(n, project.name))).length,
			questions: $questions.filter((q) => q.status === 'open' && recordInProject(q, project)).length,
			decisions: $decisions.filter((d) => recordInProject(d, project)).length
		};
	}

	// Project names on notes (typed or found by meeting extraction) that
	// aren't projects yet: offered, never created automatically.
	const HIDDEN_KEY = 'kurumi-hidden-project-suggestions';
	let hidden = $state<string[]>(
		(() => {
			try {
				return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
			} catch {
				return [];
			}
		})()
	);
	let suggestions = $derived.by(() => {
		const counts = new Map<string, { name: string; count: number }>();
		for (const m of $memoryObjects) {
			for (const name of m.projects ?? []) {
				const key = name.trim().toLowerCase();
				if (!key || $projects.some((p) => sameName(p.name, name)) || hidden.includes(key)) continue;
				counts.set(key, { name: name.trim(), count: (counts.get(key)?.count ?? 0) + 1 });
			}
		}
		return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
	});

	function hide(name: string) {
		hidden = [...hidden, name.trim().toLowerCase()];
		try {
			localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
		} catch {
			// Not persisted; fine.
		}
	}

	function create(name: string) {
		const existing = $projects.find((p) => sameName(p.name, name));
		goto(`/projects/${(existing ?? addProject(name)).id}`);
	}
</script>

<svelte:head>
	<title>Projects - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Projects</h1>
			<p class="k-page-subtitle">Notes, to-dos, decisions, questions and meetings, per project.</p>
		</div>
	</header>

	<div class="k-card mb-4">
		<QuickAdd placeholder="New project…" label="New project name" onAdd={create} />
	</div>

	{#if $projects.length > 0}
		<div class="k-segmented mb-3" role="group" aria-label="Project status">
			{#each TABS as t (t.value)}
				<button class="inline-flex items-center gap-1.5" aria-pressed={tab === t.value} onclick={() => (tab = t.value)}>
					{t.label}
					<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{counts[t.value]}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if shown.length > 0}
		<ul class="grid gap-2">
			{#each shown as project (project.id)}
				{@const s = stats(project)}
				{@const due = project.dueDate ? dueInfo(project.dueDate, project.status === 'active', today) : null}
				<li>
					<a href="/projects/{project.id}" class="project-card k-card">
						<div class="flex items-center gap-2">
							<FolderKanban class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
							<span class="min-w-0 flex-1 truncate font-medium">{project.name}</span>
							{#if project.status === 'paused'}<span class="k-badge k-badge-warn">Paused</span>{/if}
							{#if due}
								<span class="k-badge" class:k-badge-danger={due.tone === 'danger'} class:k-badge-warn={due.tone === 'warn'}>Due {due.label}</span>
							{/if}
						</div>
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">
							{#if project.owner}{project.owner} · {/if}{s.todos} open to-do{s.todos === 1 ? '' : 's'} · {s.notes} note{s.notes === 1 ? '' : 's'}{#if s.questions} · {s.questions} open question{s.questions === 1 ? '' : 's'}{/if}{#if s.decisions} · {s.decisions} decision{s.decisions === 1 ? '' : 's'}{/if}
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{:else if $projects.length > 0}
		<div class="k-empty"><FolderKanban /><p class="k-empty-title">Nothing here</p></div>
	{:else}
		<div class="k-empty">
			<FolderKanban />
			<p class="k-empty-title">No projects yet</p>
			<p>Create one above, or start from a name your notes already use.</p>
		</div>
	{/if}

	{#if suggestions.length > 0}
		<h2 class="k-section-title"><Sparkles class="h-3.5 w-3.5" /> From your notes</h2>
		<ul class="grid gap-1">
			{#each suggestions as s (s.name)}
				<li class="k-row">
					<span class="min-w-0 flex-1 truncate">{s.name}</span>
					<span class="shrink-0 text-xs text-[var(--color-text-faint)]">{s.count} note{s.count === 1 ? '' : 's'}</span>
					<button class="k-btn k-btn-sm" onclick={() => create(s.name)}>Make project</button>
					<button class="k-icon-btn" onclick={() => hide(s.name)} title="Don't suggest" aria-label="Don't suggest {s.name}">
						<X class="h-3.5 w-3.5" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.project-card {
		display: block;
		padding: 0.75rem 1rem;
		font-size: 0.9375rem;
		color: var(--color-text);
		text-decoration: none;
		transition: border-color 120ms ease;
	}

	.project-card:hover {
		border-color: var(--color-accent);
	}
</style>
