<script lang="ts">
	import {
		getPersonByName,
		getEventsByDate,
		getMemoryObjectsByPerson,
		getMemoryObjectsByDate,
		getMemoryObjectsByTag
	} from '$lib/db';
	import { X, User, Calendar, Hash, Mail, Phone, Building, Briefcase, MapPin, Clock, Users, NotebookText, ArrowRight } from 'lucide-svelte';

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
		if (type === 'person') return getMemoryObjectsByPerson(value);
		if (type === 'date') return getMemoryObjectsByDate(value);
		if (type === 'tag') return getMemoryObjectsByTag(value);
		return [];
	});

	// Position the popup just below the click, kept inside the viewport
	// (flips above the click when there isn't room below).
	const POPUP_WIDTH = 288;
	const POPUP_MAX_HEIGHT = 384;
	const MARGIN = 8;

	let popupStyle = $derived.by(() => {
		const x = Math.max(MARGIN, Math.min(position.x - 16, window.innerWidth - POPUP_WIDTH - MARGIN));
		const below = position.y + 12;
		const y =
			below + POPUP_MAX_HEIGHT <= window.innerHeight - MARGIN
				? below
				: Math.max(MARGIN, position.y - POPUP_MAX_HEIGHT - 12);
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
		// Parse as local midnight; a bare YYYY-MM-DD is UTC and shows the
		// previous day in timezones west of Greenwich.
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="popup-backdrop" onclick={onClose}></div>

<div
	class="ref-popup"
	style="{popupStyle} --ref: var(--color-ref-{type});"
	role="dialog"
	aria-label={type === 'person' ? `@${value}` : type === 'date' ? formatDate(value) : `#${value}`}
>
	<div class="popup-header">
		<span class="header-icon">
			{#if type === 'person'}
				<User class="h-3.5 w-3.5" />
			{:else if type === 'date'}
				<Calendar class="h-3.5 w-3.5" />
			{:else}
				<Hash class="h-3.5 w-3.5" />
			{/if}
		</span>
		<span class="header-title">
			{#if type === 'person'}@{value}{:else if type === 'date'}{formatDate(value)}{:else}#{value}{/if}
		</span>
		<button class="k-icon-btn" onclick={onClose} aria-label="Close" title="Close">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>

	<div class="popup-content">
		{#if type === 'person' && person}
			{#if person.title || person.company || person.email || person.phone || (person.customFields && Object.keys(person.customFields).length > 0)}
				<div class="metadata-section">
					{#if person.title}
						<div class="metadata-row">
							<Briefcase class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
							<span>{person.title}</span>
						</div>
					{/if}
					{#if person.company}
						<div class="metadata-row">
							<Building class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
							<span>{person.company}</span>
						</div>
					{/if}
					{#if person.email}
						<div class="metadata-row">
							<Mail class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
							<a href="mailto:{person.email}">{person.email}</a>
						</div>
					{/if}
					{#if person.phone}
						<div class="metadata-row">
							<Phone class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
							<a href="tel:{person.phone}">{person.phone}</a>
						</div>
					{/if}
					{#if person.customFields}
						{#each Object.entries(person.customFields) as [key, val] (key)}
							<div class="metadata-row">
								<span class="custom-key">{key}</span>
								<span>{val}</span>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		{:else if type === 'person'}
			<p class="empty-note">No profile created yet</p>
		{/if}

		{#if type === 'date' && events.length > 0}
			<div class="metadata-section">
				{#each events as event, i (i)}
					<div class="event">
						{#if event.title}
							<div class="event-title">{event.title}</div>
						{/if}
						{#if event.time}
							<div class="metadata-row">
								<Clock class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
								<span>{event.time}{event.duration ? ` (${event.duration})` : ''}</span>
							</div>
						{/if}
						{#if event.location}
							<div class="metadata-row">
								<MapPin class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
								<span>{event.location}</span>
							</div>
						{/if}
						{#if event.attendees && event.attendees.length > 0}
							<div class="metadata-row">
								<Users class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
								<span>{event.attendees.join(', ')}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if type === 'date'}
			<p class="empty-note">No events on this date</p>
		{/if}

		{#if relatedNotes.length > 0}
			<div class="k-menu-label">
				{relatedNotes.length} {relatedNotes.length === 1 ? 'note' : 'notes'}
			</div>
			{#each relatedNotes.slice(0, 5) as note (note.id)}
				<button class="k-menu-item" onclick={() => handleNoteClick(note.id)}>
					<NotebookText class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
					<span class="truncate">{note.title || 'Untitled'}</span>
				</button>
			{/each}
		{/if}
	</div>

	<div class="popup-footer">
		<button class="k-menu-item view-all" onclick={handleViewAll}>
			<span class="flex-1">View all</span>
			<ArrowRight class="h-3.5 w-3.5" />
		</button>
	</div>
</div>

<style>
	.popup-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	/* Popover surface, same family as .k-menu */
	.ref-popup {
		position: fixed;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		width: 18rem;
		max-width: calc(100vw - 1rem);
		max-height: 24rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		font-family: var(--font-sans);
		animation: slideDownFadeIn 120ms var(--ease-out);
	}

	.popup-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.375rem 0.375rem 0.75rem;
	}

	.header-icon {
		display: flex;
		color: var(--ref);
	}

	.header-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.popup-content {
		flex: 1;
		overflow-y: auto;
		padding: 0 0.25rem 0.25rem;
	}

	.metadata-section {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem 0.5rem;
	}

	.metadata-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.metadata-row a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.metadata-row a:hover {
		text-decoration: underline;
	}

	.custom-key {
		color: var(--color-text-faint);
		text-transform: capitalize;
	}

	.empty-note {
		padding: 0.25rem 0.5rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	.event + .event {
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.event-title {
		margin-bottom: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.popup-footer {
		padding: 0.25rem;
		border-top: 1px solid var(--color-border);
	}

	.view-all {
		color: var(--color-text-muted);
	}

	.view-all:hover {
		color: var(--color-text);
	}
</style>
