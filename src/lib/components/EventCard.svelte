<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		Calendar,
		Clock,
		MapPin,
		Users,
		FileText,
		Plus,
		ChevronRight,
		Pencil
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
		goto(`/note/${noteId}`);
	}

	function getPreview(content: string): string {
		return content
			.replace(/^---[\s\S]*?---\n?/, '')
			.replace(/[#@\/\[\]]/g, '')
			.trim()
			.slice(0, 100);
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

	// Get first event for display
	let primaryEvent = $derived(dateInfo.events[0] || null);
	let eventTitle = $derived(primaryEvent?.title || '');
	let eventTime = $derived(primaryEvent?.time || '');
	let eventLocation = $derived(primaryEvent?.location || '');
</script>

<li class="event-card" class:expanded>
	<button class="card-header" onclick={onToggle}>
		<div class="date-icon">
			<Calendar class="h-4 w-4" />
		</div>
		<div class="date-info">
			{#if showDate}
				<span class="date-text">{formatDate(dateInfo.date)}</span>
			{/if}
			{#if eventTitle}
				<span class="event-title">{eventTitle}</span>
			{/if}
			{#if eventTime}
				<span class="event-time">
					<Clock class="h-3 w-3" />
					{eventTime}
				</span>
			{/if}
			{#if eventLocation}
				<span class="event-location">
					<MapPin class="h-3 w-3" />
					{eventLocation}
				</span>
			{/if}
		</div>
		{#if getRelativeDate(dateInfo.date)}
			<span class="relative-date">{getRelativeDate(dateInfo.date)}</span>
		{/if}
		<span class="note-count"
			>{dateInfo.mentioningNotes.length}
			{dateInfo.mentioningNotes.length === 1 ? 'note' : 'notes'}</span
		>
		<ChevronRight class="chevron {expanded ? 'rotated' : ''}" />
	</button>

	{#if expanded}
		<div class="card-content">
			<!-- Events Section -->
			{#if dateInfo.events.length > 0}
				<div class="events-section">
					<h4>Events</h4>
					{#each dateInfo.events as event (event.id)}
						<div class="event-detail">
							{#if editingEventId === event.id}
								<!-- Edit Mode -->
								<div class="edit-form">
									<input
										type="text"
										placeholder="Event title"
										bind:value={editTitle}
										class="edit-input"
									/>
									<div class="edit-row">
										<Clock class="field-icon" />
										<input
											type="text"
											placeholder="Time (e.g., 14:00)"
											bind:value={editTime}
											class="edit-input"
										/>
									</div>
									<div class="edit-row">
										<MapPin class="field-icon" />
										<input
											type="text"
											placeholder="Location"
											bind:value={editLocation}
											class="edit-input"
										/>
									</div>
									<div class="edit-actions">
										<button class="save-btn" onclick={() => saveEdits(event.id)}>Save</button>
										<button class="cancel-btn" onclick={cancelEditing}>Cancel</button>
									</div>
								</div>
							{:else}
								<!-- View Mode -->
								<div class="event-header">
									<span class="event-detail-title">{event.title || 'Untitled Event'}</span>
									<button class="edit-btn" onclick={() => startEditing(event)}>
										<Pencil class="h-3.5 w-3.5" />
										Edit
									</button>
								</div>
								{#if event.time}
									<div class="event-meta">
										<Clock class="h-3.5 w-3.5" />
										<span
											>{event.time}{event.duration
												? ` (${event.duration})`
												: ''}</span
										>
									</div>
								{/if}
								{#if event.location}
									<div class="event-meta">
										<MapPin class="h-3.5 w-3.5" />
										<span>{event.location}</span>
									</div>
								{/if}
								{#if event.attendees && event.attendees.length > 0}
									<div class="event-meta">
										<Users class="h-3.5 w-3.5" />
										<span>{event.attendees.join(', ')}</span>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="no-events">
					<p>No events for this date</p>
					<button class="create-event-btn" onclick={createEventHandler}>
						<Plus class="h-4 w-4" />
						Create Event
					</button>
				</div>
			{/if}

			<!-- Notes Section -->
			{#if dateInfo.mentioningNotes.length > 0}
				<div class="notes-section">
					<h4>Related Notes</h4>
					<ul class="notes-list">
						{#each dateInfo.mentioningNotes as note (note.id)}
							<li>
								<button class="note-item" onclick={() => openNote(note.id)}>
									<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
									<div class="note-info">
										<span class="note-title">{note.title || 'Untitled'}</span>
										<span class="note-preview">{getPreview(note.content)}</span>
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
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		overflow: hidden;
		transition: all 0.15s ease;
	}

	.event-card:hover {
		border-color: var(--color-accent);
	}

	.event-card.expanded {
		border-color: var(--color-accent);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.card-header:hover {
		background: var(--color-bg-secondary);
	}

	.date-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
		flex-shrink: 0;
	}

	.date-info {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.date-text {
		font-weight: 500;
		color: var(--color-text);
	}

	.event-title {
		font-weight: 500;
		color: var(--color-text);
	}

	.event-time,
	.event-location {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.relative-date {
		font-size: 0.75rem;
		color: var(--color-accent);
		font-weight: 500;
	}

	.note-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 1rem;
	}

	.chevron {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-text-muted);
		transition: transform 0.15s ease;
	}

	.chevron.rotated {
		transform: rotate(90deg);
	}

	.card-content {
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.events-section {
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.events-section h4,
	.notes-section h4 {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.75rem;
	}

	.event-detail {
		padding: 0.75rem;
		background: var(--color-bg);
		border-radius: 0.375rem;
		margin-bottom: 0.5rem;
	}

	.event-detail:last-child {
		margin-bottom: 0;
	}

	.event-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.event-detail-title {
		font-weight: 500;
		color: var(--color-text);
	}

	.edit-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		cursor: pointer;
		transition: all 0.1s;
	}

	.edit-btn:hover {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.event-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-top: 0.375rem;
	}

	.no-events {
		padding: 1rem;
		text-align: center;
		border-bottom: 1px solid var(--color-border);
	}

	.no-events p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.create-event-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: white;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: all 0.1s;
	}

	.create-event-btn:hover {
		background: var(--color-accent-hover);
	}

	/* Edit form styles */
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.edit-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.field-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.edit-input {
		flex: 1;
		padding: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		outline: none;
	}

	.edit-input:focus {
		border-color: var(--color-accent);
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.save-btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: white;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.save-btn:hover {
		background: var(--color-accent-hover);
	}

	.cancel-btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.cancel-btn:hover {
		border-color: var(--color-text-muted);
	}

	.notes-section {
		padding: 0.75rem 1rem;
	}

	.notes-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.note-item {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.note-item:hover {
		background: var(--color-bg);
	}

	.note-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.note-title {
		font-size: 0.875rem;
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
