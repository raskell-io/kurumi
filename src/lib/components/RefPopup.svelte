<script lang="ts">
	import { getPersonByName, getEventsByDate, getNotesByPerson, getNotesByDate, getNotesByTag } from '$lib/db';
	import type { Person, Event, Note } from '$lib/db';
	import { X, User, Calendar, Hash, Mail, Phone, Building, Briefcase, MapPin, Clock, Users, FileText } from 'lucide-svelte';

	interface Props {
		type: 'person' | 'date' | 'tag';
		value: string;
		position: { x: number; y: number };
		onClose: () => void;
		onNavigate?: (href: string) => void;
	}

	let { type, value, position, onClose, onNavigate }: Props = $props();

	// Get data based on type
	let person = $derived(type === 'person' ? getPersonByName(value) : null);
	let events = $derived(type === 'date' ? getEventsByDate(value) : []);
	let relatedNotes = $derived.by(() => {
		if (type === 'person') return getNotesByPerson(value);
		if (type === 'date') return getNotesByDate(value);
		if (type === 'tag') return getNotesByTag(value);
		return [];
	});

	// Position the popup within viewport
	let popupStyle = $derived.by(() => {
		const x = Math.min(position.x, window.innerWidth - 320);
		const y = Math.min(position.y, window.innerHeight - 400);
		return `left: ${x}px; top: ${y}px;`;
	});

	function handleNoteClick(noteId: string) {
		if (onNavigate) {
			onNavigate(`/read/${noteId}`);
		}
		onClose();
	}

	function handleViewAll() {
		if (onNavigate) {
			if (type === 'person') onNavigate(`/read/person/${encodeURIComponent(value)}`);
			else if (type === 'date') onNavigate(`/read/date/${value}`);
			else if (type === 'tag') onNavigate(`/read/tag/${value}`);
		}
		onClose();
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="popup-backdrop" onclick={onClose}></div>

<div class="ref-popup" style={popupStyle}>
	<div class="popup-header">
		{#if type === 'person'}
			<User class="header-icon person" />
			<span class="header-title">@{value}</span>
		{:else if type === 'date'}
			<Calendar class="header-icon date" />
			<span class="header-title">{formatDate(value)}</span>
		{:else}
			<Hash class="header-icon tag" />
			<span class="header-title">#{value}</span>
		{/if}
		<button class="close-btn" onclick={onClose}>
			<X class="h-4 w-4" />
		</button>
	</div>

	<div class="popup-content">
		{#if type === 'person' && person}
			<div class="metadata-section">
				{#if person.title}
					<div class="metadata-row">
						<Briefcase class="meta-icon" />
						<span>{person.title}</span>
					</div>
				{/if}
				{#if person.company}
					<div class="metadata-row">
						<Building class="meta-icon" />
						<span>{person.company}</span>
					</div>
				{/if}
				{#if person.email}
					<div class="metadata-row">
						<Mail class="meta-icon" />
						<a href="mailto:{person.email}">{person.email}</a>
					</div>
				{/if}
				{#if person.phone}
					<div class="metadata-row">
						<Phone class="meta-icon" />
						<a href="tel:{person.phone}">{person.phone}</a>
					</div>
				{/if}
				{#if person.customFields}
					{#each Object.entries(person.customFields) as [key, val]}
						<div class="metadata-row">
							<span class="custom-key">{key}:</span>
							<span>{val}</span>
						</div>
					{/each}
				{/if}
			</div>
		{:else if type === 'person'}
			<div class="no-profile">
				<p>No profile created yet</p>
			</div>
		{/if}

		{#if type === 'date' && events.length > 0}
			<div class="metadata-section">
				{#each events as event}
					<div class="event-card">
						{#if event.title}
							<div class="event-title">{event.title}</div>
						{/if}
						{#if event.time}
							<div class="metadata-row">
								<Clock class="meta-icon" />
								<span>{event.time}{event.duration ? ` (${event.duration})` : ''}</span>
							</div>
						{/if}
						{#if event.location}
							<div class="metadata-row">
								<MapPin class="meta-icon" />
								<span>{event.location}</span>
							</div>
						{/if}
						{#if event.attendees && event.attendees.length > 0}
							<div class="metadata-row">
								<Users class="meta-icon" />
								<span>{event.attendees.join(', ')}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if type === 'date'}
			<div class="no-profile">
				<p>No events on this date</p>
			</div>
		{/if}

		{#if relatedNotes.length > 0}
			<div class="notes-section">
				<div class="section-title">
					<FileText class="h-4 w-4" />
					<span>{relatedNotes.length} {relatedNotes.length === 1 ? 'note' : 'notes'}</span>
				</div>
				<div class="notes-list">
					{#each relatedNotes.slice(0, 5) as note}
						<button class="note-item" onclick={() => handleNoteClick(note.id)}>
							{note.title || 'Untitled'}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<div class="popup-footer">
		<button class="view-all-btn" onclick={handleViewAll}>
			View all details
		</button>
	</div>
</div>

<style>
	.popup-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.ref-popup {
		position: fixed;
		z-index: 1000;
		width: 300px;
		max-height: 400px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: popupIn 0.15s ease-out;
	}

	@keyframes popupIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.popup-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.header-icon {
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
	}

	.header-icon.person {
		color: #22c55e;
	}

	.header-icon.date {
		color: #3b82f6;
	}

	.header-icon.tag {
		color: #f59e0b;
	}

	.header-title {
		flex: 1;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.close-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.popup-content {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem 1rem;
	}

	.metadata-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.metadata-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.metadata-row a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.metadata-row a:hover {
		text-decoration: underline;
	}

	.meta-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.custom-key {
		color: var(--color-text-muted);
		text-transform: capitalize;
	}

	.no-profile {
		text-align: center;
		padding: 1rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.event-card {
		padding: 0.75rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.event-title {
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.notes-section {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.notes-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.note-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text);
		cursor: pointer;
		transition: background 0.15s;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.note-item:hover {
		background: var(--color-border);
	}

	.popup-footer {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.view-all-btn {
		width: 100%;
		padding: 0.5rem;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.view-all-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
