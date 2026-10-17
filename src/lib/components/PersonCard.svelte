<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		User,
		Mail,
		Phone,
		Building,
		Briefcase,
		ChevronRight,
		NotebookText,
		Plus,
		Copy,
		ExternalLink,
		Download,
		Pencil,
		Check
	} from 'lucide-svelte';
	import type { PersonWithMetadata } from '$lib/db/store';
	import { addPerson } from '$lib/db';
	import { downloadPersonVCard } from '$lib/utils/export';

	interface Props {
		person: PersonWithMetadata;
		expanded: boolean;
		onToggle: () => void;
	}

	let { person, expanded, onToggle }: Props = $props();

	// Editing state
	let isEditing = $state(false);
	let editEmail = $state('');
	let editPhone = $state('');
	let editCompany = $state('');
	let editTitle = $state('');

	// Get custom fields (exclude known ones)
	let customFields = $derived(
		person.person?.customFields
			? Object.entries(person.person.customFields).filter(([_, value]) => value)
			: []
	);

	function openNote(noteId: string) {
		goto(`/memory/${noteId}`);
	}

	function getPreview(content: string): string {
		return content
			.replace(/^---[\s\S]*?---\n?/, '') // Remove frontmatter
			.replace(/[#@\/\[\]]/g, '')
			.trim()
			.slice(0, 100);
	}

	// Brief confirmation on the copy button that was used
	let copied = $state<string | null>(null);

	async function copyToClipboard(text: string, field: string) {
		await navigator.clipboard.writeText(text);
		copied = field;
		setTimeout(() => {
			if (copied === field) copied = null;
		}, 1500);
	}

	function createProfile() {
		// Create a new Person object - reactivity is handled by store subscription in parent
		addPerson(person.name);
	}

	function startEditing() {
		editEmail = person.person?.email || '';
		editPhone = person.person?.phone || '';
		editCompany = person.person?.company || '';
		editTitle = person.person?.title || '';
		isEditing = true;
	}

	function saveEdits() {
		if (person.person) {
			// Import updatePerson dynamically to avoid circular deps
			import('$lib/db').then(({ updatePerson }) => {
				updatePerson(person.person!.id, {
					email: editEmail || undefined,
					phone: editPhone || undefined,
					company: editCompany || undefined,
					title: editTitle || undefined
				});
			});
		}
		isEditing = false;
	}

	function cancelEditing() {
		isEditing = false;
	}
</script>

<li class="person-card" class:expanded>
	<button class="k-row card-header" onclick={onToggle} aria-expanded={expanded}>
		<ChevronRight class="chevron h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] {expanded ? 'expanded' : ''}" />
		<User class="h-4 w-4 shrink-0 text-[var(--color-ref-person)]" />
		<span class="person-name">@{person.name}</span>
		<span class="quick-info">{person.person?.email ?? ''}</span>
		<span class="mention-count">{person.count} {person.count === 1 ? 'note' : 'notes'}</span>
	</button>

	{#if expanded}
		<div class="card-panel">
			<!-- Metadata Section -->
			{#if person.person}
				<div class="metadata-section">
					{#if isEditing}
						<!-- Edit Mode -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="edit-form"
							onkeydown={(e) => {
								if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') saveEdits();
								else if (e.key === 'Escape') {
									e.stopPropagation();
									cancelEditing();
								}
							}}
						>
							<label class="edit-field">
								<Mail class="field-icon h-3.5 w-3.5" />
								<input type="email" placeholder="Email" aria-label="Email" bind:value={editEmail} class="k-input edit-input" />
							</label>
							<label class="edit-field">
								<Phone class="field-icon h-3.5 w-3.5" />
								<input type="tel" placeholder="Phone" aria-label="Phone" bind:value={editPhone} class="k-input edit-input" />
							</label>
							<label class="edit-field">
								<Building class="field-icon h-3.5 w-3.5" />
								<input type="text" placeholder="Company" aria-label="Company" bind:value={editCompany} class="k-input edit-input" />
							</label>
							<label class="edit-field">
								<Briefcase class="field-icon h-3.5 w-3.5" />
								<input type="text" placeholder="Title" aria-label="Title" bind:value={editTitle} class="k-input edit-input" />
							</label>
							<div class="edit-actions">
								<button class="k-btn k-btn-ghost k-btn-sm" onclick={cancelEditing}>Cancel</button>
								<button class="k-btn k-btn-primary k-btn-sm" onclick={saveEdits}>Save</button>
							</div>
						</div>
					{:else}
						<!-- View Mode -->
						{#if person.person.email}
							<div class="metadata-field">
								<Mail class="field-icon h-3.5 w-3.5" />
								<span class="field-value">{person.person.email}</span>
								<button
									class="k-icon-btn field-action"
									onclick={() => copyToClipboard(person.person?.email || '', 'email')}
									title="Copy email"
									aria-label="Copy email"
								>
									{#if copied === 'email'}
										<Check class="h-3.5 w-3.5" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
								<a
									href="mailto:{person.person.email}"
									class="k-icon-btn field-action"
									title="Send email"
									aria-label="Send email"
								>
									<ExternalLink class="h-3.5 w-3.5" />
								</a>
							</div>
						{/if}

						{#if person.person.phone}
							<div class="metadata-field">
								<Phone class="field-icon h-3.5 w-3.5" />
								<span class="field-value">{person.person.phone}</span>
								<button
									class="k-icon-btn field-action"
									onclick={() => copyToClipboard(person.person?.phone || '', 'phone')}
									title="Copy phone"
									aria-label="Copy phone"
								>
									{#if copied === 'phone'}
										<Check class="h-3.5 w-3.5" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
								<a href="tel:{person.person.phone}" class="k-icon-btn field-action" title="Call" aria-label="Call">
									<ExternalLink class="h-3.5 w-3.5" />
								</a>
							</div>
						{/if}

						{#if person.person.company}
							<div class="metadata-field">
								<Building class="field-icon h-3.5 w-3.5" />
								<span class="field-value">{person.person.company}</span>
							</div>
						{/if}

						{#if person.person.title}
							<div class="metadata-field">
								<Briefcase class="field-icon h-3.5 w-3.5" />
								<span class="field-value">{person.person.title}</span>
							</div>
						{/if}

						{#each customFields as [key, value] (key)}
							<div class="metadata-field">
								<span class="field-key">{key}</span>
								<span class="field-value">{value}</span>
							</div>
						{/each}

						<div class="profile-actions">
							<button class="k-btn k-btn-sm" onclick={startEditing}>
								<Pencil class="h-3.5 w-3.5" />
								Edit
							</button>
							<button class="k-btn k-btn-sm" onclick={() => downloadPersonVCard(person)}>
								<Download class="h-3.5 w-3.5" />
								vCard
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="no-profile">
					<p>No profile yet. Add contact details to keep them next to the notes.</p>
					<button class="k-btn k-btn-primary k-btn-sm" onclick={createProfile}>
						<Plus class="h-3.5 w-3.5" />
						Create profile
					</button>
				</div>
			{/if}

			<!-- Mentioning Notes -->
			{#if person.mentioningMemories.length > 0}
				<div class="notes-section">
					<div class="k-menu-label">Mentioned in</div>
					<ul class="notes-list">
						{#each person.mentioningMemories as memory (memory.id)}
							<li>
								<button class="k-row note-item" onclick={() => openNote(memory.id)}>
									<NotebookText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									<span class="note-title">{memory.title || 'Untitled'}</span>
									<span class="note-preview">{getPreview(memory.bodyMarkdown)}</span>
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
	.person-card {
		list-style: none;
	}

	.card-header {
		width: 100%;
		text-align: left;
	}

	.expanded .card-header {
		background: var(--color-hover);
	}

	.person-name {
		flex-shrink: 0;
		max-width: 50%;
		overflow: hidden;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.quick-info {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.mention-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	/* Expanded detail: popover-style surface (border, radius-lg, shadow) */
	.card-panel {
		margin: 0.25rem 0 0.75rem 1.5rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-md);
		animation: slideDownFadeIn 120ms var(--ease-out);
	}

	.metadata-section {
		padding: 0.625rem 0.75rem 0.75rem;
	}

	.metadata-section,
	.no-profile {
		border-bottom: 1px solid var(--color-border);
	}

	.card-panel > :last-child {
		border-bottom: none;
	}

	.metadata-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.75rem;
	}

	.metadata-field :global(.field-icon),
	.edit-field :global(.field-icon) {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.field-key {
		font-size: 0.75rem;
		color: var(--color-text-faint);
		text-transform: capitalize;
	}

	.field-value {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.field-action {
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-text-faint);
	}

	.profile-actions {
		display: flex;
		gap: 0.375rem;
		margin-top: 0.625rem;
	}

	.no-profile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.75rem;
	}

	.no-profile p {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* Edit form */
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.edit-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.edit-input {
		flex: 1;
		height: 2rem;
		font-size: 0.8125rem;
	}

	.edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	/* Mentioning notes */
	.notes-section {
		padding: 0.25rem;
	}

	.notes-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.note-item {
		width: 100%;
		text-align: left;
	}

	.note-title {
		flex-shrink: 0;
		max-width: 55%;
		overflow: hidden;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.note-preview {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	@media (max-width: 640px) {
		.card-panel {
			margin-left: 0;
		}

		.quick-info {
			display: none;
		}

		.person-name {
			flex: 1;
			max-width: none;
		}
	}
</style>
