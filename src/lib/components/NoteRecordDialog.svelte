<script lang="ts" module>
	export type RecordKind = 'decision' | 'question' | 'agenda';
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import {
		meetingSeries,
		addDecision,
		addQuestion,
		addAgendaItem,
		type MemoryObject
	} from '$lib/db';
	import { portal } from '$lib/actions/portal';
	import { autofocus } from '$lib/actions/autofocus';

	// From a note's ⋯ menu: log a decision, add an open question, or put
	// something on a recurring meeting's agenda, linked back to the note.

	let { memory, kind, onDone }: { memory: MemoryObject; kind: RecordKind; onDone: (message: string | null) => void } = $props();

	const TITLES: Record<RecordKind, string> = {
		decision: 'Log a decision',
		question: 'Add an open question',
		agenda: 'Add to a meeting agenda'
	};

	// Agenda items default to a link back to the note.
	let text = $state(untrack(() => (kind === 'agenda' ? `[[${memory.title || 'Untitled'}]]` : '')));
	let extra = $state(''); // rationale (decision) or who should answer (question)

	// Agenda: the note's own series first, then series sharing its people.
	const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	let seriesOptions = $derived(
		[...$meetingSeries].sort((a, b) => score(b) - score(a))
	);
	function score(s: (typeof $meetingSeries)[number]) {
		if (s.id === memory.seriesId) return 100;
		return s.people.filter((p) => (memory.participants ?? []).some((q) => sameName(p, q))).length;
	}
	let seriesId = $state('');
	$effect(() => {
		if (!seriesId && seriesOptions[0]) seriesId = seriesOptions[0].id;
	});

	function save(e: SubmitEvent) {
		e.preventDefault();
		const value = text.trim();
		if (!value) return;
		if (kind === 'decision') {
			addDecision({ text: value, rationale: extra.trim(), memoryId: memory.id, decidedBy: [...(memory.participants ?? [])] });
			onDone('Logged in Decisions');
		} else if (kind === 'question') {
			addQuestion({ text: value, assignee: extra.trim() || null, memoryId: memory.id });
			onDone('Added to Questions');
		} else if (seriesId) {
			addAgendaItem(seriesId, value);
			onDone(`On the agenda for ${$meetingSeries.find((s) => s.id === seriesId)?.name}`);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div use:portal class="k-dialog-backdrop" onclick={() => onDone(null)} role="presentation">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		class="k-dialog grid gap-3 p-5"
		onsubmit={save}
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.key === 'Escape' && onDone(null)}
		aria-label={TITLES[kind]}
	>
		<h2 class="text-base font-semibold text-[var(--color-text)]">{TITLES[kind]}</h2>

		{#if kind === 'agenda' && $meetingSeries.length === 0}
			<p class="text-sm text-[var(--color-text-muted)]">
				No recurring meetings yet. <a href="/meetings" onclick={() => onDone(null)}>Create one</a> first.
			</p>
		{:else}
			{#if kind === 'agenda'}
				<select class="k-input" bind:value={seriesId} aria-label="Meeting">
					{#each seriesOptions as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</select>
			{/if}
			<input
				class="k-input"
				bind:value={text}
				use:autofocus={{ select: true }}
				placeholder={kind === 'decision' ? 'What was decided?' : kind === 'question' ? 'What needs answering?' : 'What to discuss'}
				aria-label={kind === 'decision' ? 'Decision' : kind === 'question' ? 'Question' : 'Agenda item'}
			/>
			{#if kind !== 'agenda'}
				<input
					class="k-input"
					bind:value={extra}
					placeholder={kind === 'decision' ? 'Why? (optional)' : 'Who should answer? (optional)'}
					aria-label={kind === 'decision' ? 'Rationale' : 'Who should answer'}
				/>
			{/if}
			<p class="text-xs text-[var(--color-text-faint)]">Linked to “{memory.title || 'Untitled'}”.</p>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="k-btn k-btn-ghost" onclick={() => onDone(null)}>Cancel</button>
			{#if !(kind === 'agenda' && $meetingSeries.length === 0)}
				<button class="k-btn k-btn-primary" disabled={!text.trim()}>{kind === 'agenda' ? 'Add' : 'Save'}</button>
			{/if}
		</div>
	</form>
</div>
