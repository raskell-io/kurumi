<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		meetingSeries,
		projects,
		memoryObjects,
		updateMeetingSeries,
		addAgendaItem,
		removeAgendaItem,
		startSeriesMeeting,
		deleteRecord,
		restoreRecord,
		todayIso,
		type MeetingCadence,
		type MeetingSeries
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { CADENCE_LABELS, meetingsOf, nextMeetingDate } from '$lib/meetings';
	import { dueInfo } from '$lib/utils/due';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import { ChevronLeft, Play, X, NotebookText, Trash2, ListChecks } from 'lucide-svelte';

	const today = todayIso();
	let series = $derived($meetingSeries.find((m) => m.id === $page.params.id));
	let openAgenda = $derived(series ? series.agenda.filter((a) => !a.meetingId) : []);
	let meetings = $derived(series ? meetingsOf(series.id, $memoryObjects) : []);
	let next = $derived(series ? nextMeetingDate(series.cadence, meetings[0]) : null);
	let due = $derived(next ? dueInfo(next, true, today) : null);
	let todaysMeeting = $derived(meetings.find((m) => new Date(m.createdAt).toISOString().slice(0, 10) === today));

	function start() {
		if (!series) return;
		const note = startSeriesMeeting(series.id);
		if (note) goto(`/memory/${note.id}`);
	}

	function remove() {
		if (!series) return;
		const snapshot = deleteRecord<MeetingSeries>('meetingSeries', series.id);
		if (snapshot) pushUndo({ label: `Deleted “${snapshot.name}”`, undo: () => restoreRecord('meetingSeries', snapshot) });
		goto('/meetings');
	}
</script>

<svelte:head>
	<title>{series?.name ?? 'Meeting'} - Kurumi</title>
</svelte:head>

<div class="k-page">
	<a href="/meetings" class="mb-3 inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text)]">
		<ChevronLeft class="h-4 w-4" /> Meetings
	</a>

	{#if !series}
		<div class="k-empty"><p class="k-empty-title">Meeting not found</p></div>
	{:else}
		<input
			class="series-title"
			value={series.name}
			aria-label="Meeting name"
			onchange={(e) => {
				const v = (e.currentTarget as HTMLInputElement).value.trim();
				if (v) updateMeetingSeries(series!.id, { name: v });
			}}
		/>

		<div class="series-props">
			<label>
				<span>People</span>
				<input
					class="k-input !h-8"
					value={series.people.join(', ')}
					placeholder="Comma separated"
					onchange={(e) => updateMeetingSeries(series!.id, { people: (e.currentTarget as HTMLInputElement).value.split(',').map((p) => p.trim()).filter(Boolean) })}
				/>
			</label>
			<label>
				<span>How often</span>
				<select class="k-input !h-8 !py-0" value={series.cadence} onchange={(e) => updateMeetingSeries(series!.id, { cadence: (e.currentTarget as HTMLSelectElement).value as MeetingCadence })}>
					{#each Object.entries(CADENCE_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</label>
			<label>
				<span>Project</span>
				<select class="k-input !h-8 !py-0" value={series.projectId ?? ''} onchange={(e) => updateMeetingSeries(series!.id, { projectId: (e.currentTarget as HTMLSelectElement).value || null })}>
					<option value="">None</option>
					{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>
		</div>

		<div class="my-5 flex flex-wrap items-center gap-3">
			{#if todaysMeeting}
				<a href="/memory/{todaysMeeting.id}" class="k-btn k-btn-primary no-underline"><NotebookText class="h-4 w-4" /> Open today's meeting</a>
				<button class="k-btn" onclick={start}><Play class="h-4 w-4" /> Start another</button>
			{:else}
				<button class="k-btn k-btn-primary" onclick={start}><Play class="h-4 w-4" /> Start meeting</button>
			{/if}
			<span class="text-sm text-[var(--color-text-muted)]">
				{#if due}Next one {due.label === 'Today' ? 'is today' : due.tone === 'danger' ? `was due ${due.label}` : `is ${due.label}`}{:else if meetings.length === 0}Not held yet{/if}
			</span>
		</div>
		<p class="-mt-3 mb-4 text-xs text-[var(--color-text-faint)]">
			Starting creates today's note with the agenda below, plus open to-dos and questions for {series.people.length ? series.people.join(', ') : 'its people'}{series.projectId ? ' and the project' : ''}.
		</p>

		<h2 class="k-section-title"><ListChecks class="h-3.5 w-3.5" /> Agenda for next time <span class="font-normal tabular-nums">{openAgenda.length}</span></h2>
		<div class="k-card p-1">
			{#each openAgenda as item (item.id)}
				<div class="k-row group">
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-faint)]"></span>
					<span class="min-w-0 flex-1">{item.text}</span>
					<button class="k-icon-btn opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onclick={() => removeAgendaItem(series!.id, item.id)} aria-label="Remove “{item.text}”"><X class="h-3.5 w-3.5" /></button>
				</div>
			{/each}
			<QuickAdd placeholder="Add something to discuss…" onAdd={(text) => addAgendaItem(series!.id, text)} />
		</div>

		<h2 class="k-section-title"><NotebookText class="h-3.5 w-3.5" /> Past meetings <span class="font-normal tabular-nums">{meetings.length}</span></h2>
		{#if meetings.length}
			<div class="k-card p-1">
				{#each meetings as m (m.id)}
					<a href="/memory/{m.id}" class="k-row">
						<span class="min-w-0 flex-1 truncate">{m.title || 'Untitled'}</span>
						<span class="text-xs text-[var(--color-text-faint)]">{series.agenda.filter((a) => a.meetingId === m.id).length} agenda items</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="px-1 text-sm text-[var(--color-text-faint)]">None yet.</p>
		{/if}

		<div class="mt-10 border-t border-[var(--color-border)] pt-4">
			<button class="k-btn k-btn-ghost k-btn-sm !text-[var(--color-danger)]" onclick={remove}><Trash2 class="h-3.5 w-3.5" /> Delete recurring meeting</button>
			<span class="ml-2 text-xs text-[var(--color-text-faint)]">Meeting notes are kept.</span>
		</div>
	{/if}
</div>

<style>
	.series-title,
	.series-title:focus,
	.series-title:focus-visible {
		width: 100%;
		border: none !important;
		background: transparent;
		color: var(--color-text);
		font-size: 1.75rem;
		font-weight: 700;
		outline: none !important;
		box-shadow: none !important;
	}

	.series-props {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		margin-top: 0.75rem;
	}

	.series-props label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.series-props label :global(.k-input) {
		width: auto;
		min-width: 9rem;
	}
</style>
