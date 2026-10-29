<script lang="ts">
	import { markdownExcerpt } from '$lib/utils/excerpt';
	import { goto } from '$app/navigation';
	import {
		Calendar,
		Clock,
		MapPin,
		Users,
		NotebookText,
		Plus,
		ChevronRight,
		Pencil,
		CircleCheck,
		CalendarClock
	} from 'lucide-svelte';
	import type { DateWithEvents } from '$lib/db/store';
	import { addEvent } from '$lib/db';
	import type { Event } from '$lib/db/types';

	interface Props {
		dateInfo: DateWithEvents;
		expanded: boolean;
		onToggle: () => void;
		showDate?: boolean;
	}

	let { dateInfo, expanded, onToggle, showDate = true }: Props = $props();

	// Editing state
	let editingEventId = $state<string | null>(null);
	let editTitle = $state('');
	let editTime = $state('');
	let editLocation = $state('');

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	function getRelativeDate(dateStr: string): string {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const date = new Date(dateStr + 'T00:00:00');
		const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		if (diffDays === -1) return 'Yesterday';
		if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
		if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
		return '';
	}

	function openNote(noteId: string) {
		goto(`/memory/${noteId}`);
	}

	function createEventHandler() {
		// Create a new Event object - reactivity is handled by store subscription in parent
		addEvent(dateInfo.date, { title: 'New Event' });
	}

	function startEditing(event: Event) {
		editingEventId = event.id;
		editTitle = event.title || '';
		editTime = event.time || '';
		editLocation = event.location || '';
	}

	function saveEdits(eventId: string) {
		import('$lib/db').then(({ updateEvent }) => {
			updateEvent(eventId, {
				title: editTitle || undefined,
				time: editTime || undefined,
				location: editLocation || undefined
			});
		});
		editingEventId = null;
	}

	function cancelEditing() {
		editingEventId = null;
	}

	function handleEditKeydown(e: KeyboardEvent, eventId: string) {
		if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
			e.preventDefault();
			saveEdits(eventId);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEditing();
		}
	}

	// Get first event for display
	let primaryEvent = $derived(dateInfo.events[0] || null);
	let eventTitle = $derived(primaryEvent?.title || '');
	let eventTime = $derived(primaryEvent?.time || '');
	let eventLocation = $derived(primaryEvent?.location || '');

	let todos = $derived(dateInfo.todos ?? []);
	let meetings = $derived(dateInfo.meetings ?? []);
	// Without an event, the first meeting or to-do names the row.
	let rowTitle = $derived(eventTitle || meetings[0]?.name || todos[0]?.text || '');
	let counts = $derived(
		[
			todos.length && `${todos.length} to-do${todos.length === 1 ? '' : 's'}`,
			meetings.length && `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`,
			dateInfo.mentioningMemories.length && `${dateInfo.mentioningMemories.length} note${dateInfo.mentioningMemories.length === 1 ? '' : 's'}`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<li class="event-card" class:expanded>
	<button class="card-header" onclick={onToggle} aria-expanded={expanded}>
		<Calendar class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
		<div class="date-info">
			{#if showDate}
				<span class="date-text">{formatDate(dateInfo.date)}</span>
			{/if}
			{#if rowTitle}
				<span class="event-title">{rowTitle}</span>
			{/if}
			{#if eventTime}
				<span class="event-meta-inline">
					<Clock class="h-3 w-3" />
					{eventTime}
				</span>
			{/if}
			{#if eventLocation}
				<span class="event-meta-inline">
					<MapPin class="h-3 w-3" />
					{eventLocation}
				</span>
			{/if}
		</div>
		{#if getRelativeDate(dateInfo.date)}
			<span class="relative-date">{getRelativeDate(dateInfo.date)}</span>
		{/if}
		<span class="note-count">{counts}</span>
		<ChevronRight class="chevron h-4 w-4 shrink-0 text-[var(--color-text-faint)] {expanded ? 'expanded' : ''}" />
	</button>

	{#if expanded}
		<div class="card-content">
			<!-- Events Section -->
			{#if dateInfo.events.length > 0}
				<div class="content-section">
					<h4 class="content-label">Events</h4>
					{#each dateInfo.events as event (event.id)}
						<div class="event-detail">
							{#if editingEventId === event.id}
								<!-- Edit Mode -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="edit-form" onkeydown={(e) => handleEditKeydown(e, event.id)}>
									<input
										type="text"
										placeholder="Event title"
										bind:value={editTitle}
										class="k-input"
										aria-label="Event title"
									/>
									<div class="edit-row">
										<Clock class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
										<input
											type="text"
											placeholder="Time (e.g., 14:00)"
											bind:value={editTime}
											class="k-input"
											aria-label="Time"
										/>
									</div>
									<div class="edit-row">
										<MapPin class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
										<input
											type="text"
											placeholder="Location"
											bind:value={editLocation}
											class="k-input"
											aria-label="Location"
										/>
									</div>
									<div class="edit-actions">
										<button class="k-btn k-btn-sm k-btn-primary" onclick={() => saveEdits(event.id)}>Save</button>
										<button class="k-btn k-btn-sm k-btn-ghost" onclick={cancelEditing}>Cancel</button>
									</div>
								</div>
							{:else}
								<!-- View Mode -->
								<div class="event-header">
									<span class="event-detail-title">{event.title || 'Untitled event'}</span>
									<button
										class="k-icon-btn"
										onclick={() => startEditing(event)}
										aria-label="Edit event"
										title="Edit event"
									>
										<Pencil class="h-3.5 w-3.5" />
									</button>
								</div>
								{#if event.time}
									<div class="event-meta">
										<Clock class="h-3.5 w-3.5 shrink-0" />
										<span
											>{event.time}{event.duration
												? ` (${event.duration})`
												: ''}</span
										>
									</div>
								{/if}
								{#if event.location}
									<div class="event-meta">
										<MapPin class="h-3.5 w-3.5 shrink-0" />
										<span>{event.location}</span>
									</div>
								{/if}
								{#if event.attendees && event.attendees.length > 0}
									<div class="event-meta">
										<Users class="h-3.5 w-3.5 shrink-0" />
										<span>{event.attendees.join(', ')}</span>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="content-section no-events">
					<span>No events for this date</span>
					<button class="k-btn k-btn-sm" onclick={createEventHandler}>
						<Plus class="h-3.5 w-3.5" />
						Add event
					</button>
				</div>
			{/if}

			{#if todos.length > 0}
				<div class="content-section">
					<h4 class="content-label">To-dos due</h4>
					<ul class="notes-list">
						{#each todos as todo (todo.id)}
							<li>
								<a class="k-row note-item" href={todo.memoryObjectId ? `/memory/${todo.memoryObjectId}` : '/actions'}>
									<CircleCheck class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									<div class="note-info">
										<span class="note-title">{todo.text}</span>
										{#if todo.assignee}<span class="note-preview">{todo.assignee}</span>{/if}
									</div>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if meetings.length > 0}
				<div class="content-section">
					<h4 class="content-label">Meetings</h4>
					<ul class="notes-list">
						{#each meetings as series (series.id)}
							<li>
								<a class="k-row note-item" href="/meetings/{series.id}">
									<CalendarClock class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									<div class="note-info">
										<span class="note-title">{series.name}</span>
										<span class="note-preview">Next one expected · {series.agenda.filter((a) => !a.meetingId).length} on the agenda</span>
									</div>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Notes Section -->
			{#if dateInfo.mentioningMemories.length > 0}
				<div class="content-section">
					<h4 class="content-label">Related notes</h4>
					<ul class="notes-list">
						{#each dateInfo.mentioningMemories as memory (memory.id)}
							<li>
								<button class="k-row note-item" onclick={() => openNote(memory.id)}>
									<NotebookText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									<div class="note-info">
										<span class="note-title">{memory.title || 'Untitled'}</span>
										{#if markdownExcerpt(memory.bodyMarkdown, 100)}
											<span class="note-preview">{markdownExcerpt(memory.bodyMarkdown, 100)}</span>
										{/if}
									</div>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</li>

<style>
	.event-card {
		border-radius: var(--radius-md);
	}

	.event-card.expanded {
		background: var(--color-hover);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		min-height: 2.25rem;
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.card-header:hover {
		background: var(--color-hover);
	}

	.date-info {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.125rem 0.625rem;
		min-width: 0;
	}

	.date-text {
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
	}

	.event-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.event-meta-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.relative-date {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-ref-date);
	}

	.note-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}

	/* Indented under the header text (icon 1rem + gap) */
	.card-content {
		padding: 0.25rem 0.625rem 0.625rem 2.25rem;
	}

	.content-section + .content-section {
		margin-top: 0.75rem;
	}

	.content-label {
		margin-bottom: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-faint);
	}

	.event-detail + .event-detail {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.event-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.event-detail-title {
		min-width: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.event-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.no-events {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.25rem;
	}

	.edit-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.edit-actions {
		display: flex;
		gap: 0.25rem;
	}

	.notes-list {
		list-style: none;
		padding: 0;
		margin: 0 0 0 -0.625rem;
	}

	.note-item {
		width: 100%;
		align-items: flex-start;
		text-align: left;
		cursor: pointer;
	}

	.note-item :global(svg) {
		margin-top: 0.125rem;
	}

	.note-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.note-title {
		font-weight: 500;
		color: var(--color-text);
	}

	.note-preview {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
