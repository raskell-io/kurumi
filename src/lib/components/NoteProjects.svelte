<script lang="ts">
	import { projects, addProject, setMemoryInProject, type MemoryObject } from '$lib/db';
	import { portal } from '$lib/actions/portal';
	import { autofocus } from '$lib/actions/autofocus';
	import { goto } from '$app/navigation';
	import { FolderKanban, X, Plus } from 'lucide-svelte';

	// Project chips under a note's title, plus the picker that links one.
	// Notes link to projects by name (like meeting extraction does), so a
	// name that isn't a project yet shows as a dashed chip you can promote.
	let { memory, picker = $bindable(null) }: { memory: MemoryObject; picker?: DOMRect | null } = $props();

	const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	let chips = $derived(
		(memory.projects ?? []).map((name) => ({ name, project: $projects.find((p) => sameName(p.name, name)) }))
	);

	let query = $state('');
	let options = $derived(
		$projects.filter(
			(p) =>
				p.status !== 'archived' &&
				!(memory.projects ?? []).some((n) => sameName(n, p.name)) &&
				p.name.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
	let canCreate = $derived(!!query.trim() && !$projects.some((p) => sameName(p.name, query)));

	function link(name: string) {
		setMemoryInProject(memory.id, name, true);
		picker = null;
		query = '';
	}

	function createAndLink() {
		const name = query.trim();
		addProject(name);
		link(name);
	}

	function place(node: HTMLElement) {
		if (!picker) return;
		node.style.top = `${picker.bottom + 4}px`;
		node.style.left = `${Math.min(picker.left, window.innerWidth - node.offsetWidth - 8)}px`;
	}
</script>

{#if chips.length}
	<div class="mb-3 flex flex-wrap items-center gap-1.5">
		{#each chips as chip (chip.name)}
			<span class="project-chip" class:dashed={!chip.project}>
				<FolderKanban class="h-3 w-3" />
				{#if chip.project}
					<a href="/projects/{chip.project.id}">{chip.name}</a>
				{:else}
					<button
						title="Not a project yet. Click to make it one."
						onclick={() => goto(`/projects/${addProject(chip.name).id}`)}
					>{chip.name}</button>
				{/if}
				<button class="chip-x" onclick={() => setMemoryInProject(memory.id, chip.name, false)} aria-label="Remove from {chip.name}">
					<X class="h-3 w-3" />
				</button>
			</span>
		{/each}
	</div>
{/if}

{#if picker}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[150]" onclick={() => (picker = null)}></div>
	<div use:portal use:place class="k-menu fixed z-[151] w-64" role="dialog" aria-label="Add to project">
		<input
			class="k-input mb-1 !h-8"
			bind:value={query}
			use:autofocus
			placeholder="Find or create a project…"
			aria-label="Project name"
			onkeydown={(e) => {
				if (e.key === 'Escape') picker = null;
				if (e.key === 'Enter') {
					e.preventDefault();
					if (options[0]) link(options[0].name);
					else if (canCreate) createAndLink();
				}
			}}
		/>
		{#each options.slice(0, 8) as p (p.id)}
			<button class="k-menu-item" onclick={() => link(p.name)}><FolderKanban class="h-4 w-4" /> <span class="truncate">{p.name}</span></button>
		{/each}
		{#if canCreate}
			<button class="k-menu-item" onclick={createAndLink}><Plus class="h-4 w-4" /> Create “{query.trim()}”</button>
		{:else if options.length === 0}
			<p class="px-2 py-1.5 text-xs text-[var(--color-text-faint)]">Type a name to create a project.</p>
		{/if}
	</div>
{/if}

<style>
	.project-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.625rem;
		padding: 0 0.25rem 0 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.project-chip.dashed {
		border-style: dashed;
	}

	.project-chip a,
	.project-chip button:not(.chip-x) {
		color: var(--color-text);
		text-decoration: none;
	}

	.chip-x {
		display: flex;
		border-radius: 999px;
		padding: 0.125rem;
		color: var(--color-text-faint);
	}

	.chip-x:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}
</style>
