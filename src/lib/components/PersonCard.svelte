<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		User,
		Mail,
		Phone,
		Building,
		Briefcase,
		ChevronRight,
		FileText,
		Plus,
		Copy,
		ExternalLink,
		Download
	} from 'lucide-svelte';
	import type { PersonWithMetadata } from '$lib/db/store';
	import { downloadPersonVCard } from '$lib/utils/export';
	import { addNote } from '$lib/db';

	interface Props {
		person: PersonWithMetadata;
		expanded: boolean;
		onToggle: () => void;
	}

	let { person, expanded, onToggle }: Props = $props();

	// Known field icons
	const fieldIcons: Record<string, typeof Mail> = {
		email: Mail,
		phone: Phone,
		company: Building,
		title: Briefcase
	};

	// Get custom fields (exclude known ones)
	let customFields = $derived(
		person.metadata
			? Object.entries(person.metadata).filter(
					([key, value]) =>
						!['type', 'email', 'phone', 'company', 'title'].includes(key) && value
				)
			: []
	);

	function openNote(noteId: string) {
		goto(`/note/${noteId}`);
	}

	function getPreview(content: string): string {
		return content
			.replace(/^---[\s\S]*?---\n?/, '') // Remove frontmatter
			.replace(/[#@\/\[\]]/g, '')
			.trim()
			.slice(0, 100);
	}

	async function copyToClipboard(text: string) {
		await navigator.clipboard.writeText(text);
	}

	async function createProfile() {
		// Create a new note with person frontmatter
		const note = addNote(
			person.name,
			`---
type: person
email:
phone:
company:
---

# ${person.name}

`,
			null
		);
		goto(`/note/${note.id}`);
	}
</script>

<li class="person-card" class:expanded>
	<button class="card-header" onclick={onToggle}>
		<div class="person-icon">
			<User class="h-4 w-4" />
		</div>
		<span class="person-name">@{person.name}</span>
		{#if person.metadata?.email}
			<span class="quick-info">{person.metadata.email}</span>
		{/if}
		<span class="mention-count">{person.count} {person.count === 1 ? 'note' : 'notes'}</span>
		<ChevronRight class="chevron {expanded ? 'rotated' : ''}" />
	</button>

	{#if expanded}
		<div class="card-content">
			<!-- Metadata Section -->
			{#if person.metadata || person.definitionNote}
				<div class="metadata-section">
					{#if person.metadata?.email}
						<div class="metadata-field">
							<Mail class="field-icon" />
							<span class="field-value">{person.metadata.email}</span>
							<button
								class="field-action"
								onclick={() => copyToClipboard(String(person.metadata?.email))}
								title="Copy email"
							>
								<Copy class="h-3.5 w-3.5" />
							</button>
							<a
								href="mailto:{person.metadata.email}"
								class="field-action"
								title="Send email"
							>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</div>
					{/if}

					{#if person.metadata?.phone}
						<div class="metadata-field">
							<Phone class="field-icon" />
							<span class="field-value">{person.metadata.phone}</span>
							<button
								class="field-action"
								onclick={() => copyToClipboard(String(person.metadata?.phone))}
								title="Copy phone"
							>
								<Copy class="h-3.5 w-3.5" />
							</button>
							<a href="tel:{person.metadata.phone}" class="field-action" title="Call">
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</div>
					{/if}

					{#if person.metadata?.company}
						<div class="metadata-field">
							<Building class="field-icon" />
							<span class="field-value">{person.metadata.company}</span>
						</div>
					{/if}

					{#if person.metadata?.title}
						<div class="metadata-field">
							<Briefcase class="field-icon" />
							<span class="field-value">{person.metadata.title}</span>
						</div>
					{/if}

					{#each customFields as [key, value]}
						<div class="metadata-field custom">
							<span class="field-key">{key}:</span>
							<span class="field-value">{value}</span>
						</div>
					{/each}

					{#if person.definitionNote}
						<div class="profile-actions">
							<button class="action-btn" onclick={() => openNote(person.definitionNote!.id)}>
								<FileText class="h-4 w-4" />
								Edit Profile
							</button>
							<button class="action-btn" onclick={() => downloadPersonVCard(person)}>
								<Download class="h-4 w-4" />
								vCard
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="no-profile">
					<p>No profile note found</p>
					<button class="create-profile-btn" onclick={createProfile}>
						<Plus class="h-4 w-4" />
						Create Profile
					</button>
				</div>
			{/if}

			<!-- Mentioning Notes -->
			<div class="notes-section">
				<h4>Mentioned in</h4>
				<ul class="notes-list">
					{#each person.mentioningNotes as note (note.id)}
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
		</div>
	{/if}
</li>

<style>
	.person-card {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		overflow: hidden;
		transition: all 0.15s ease;
	}

	.person-card:hover {
		border-color: var(--color-accent);
	}

	.person-card.expanded {
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

	.person-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
		flex-shrink: 0;
	}

	.person-name {
		font-weight: 500;
		color: var(--color-text);
	}

	.quick-info {
		flex: 1;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mention-count {
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

	.metadata-section {
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.metadata-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0;
	}

	.field-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.field-key {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: capitalize;
	}

	.field-value {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.field-action {
		padding: 0.25rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.1s;
	}

	.field-action:hover {
		color: var(--color-accent);
		background: var(--color-bg);
	}

	.profile-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
		transition: all 0.1s;
	}

	.action-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.no-profile {
		padding: 1rem;
		text-align: center;
		border-bottom: 1px solid var(--color-border);
	}

	.no-profile p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.create-profile-btn {
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

	.create-profile-btn:hover {
		background: var(--color-accent-hover);
	}

	.notes-section {
		padding: 0.75rem 1rem;
	}

	.notes-section h4 {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
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
