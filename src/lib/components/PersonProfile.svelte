<script lang="ts">
	import { Mail, Phone, Building, Briefcase, Plus, Copy, ExternalLink, Download, Pencil, Check } from 'lucide-svelte';
	import type { PersonWithMetadata } from '$lib/db/store';
	import { addPerson, updatePerson } from '$lib/db';
	import { downloadPersonVCard } from '$lib/utils/export';

	// A person's contact profile: view, edit, create, vCard.
	interface Props {
		person: PersonWithMetadata;
	}

	let { person }: Props = $props();

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
		// The page re-reads the people store, so the new profile shows up
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
		// Empty strings, not undefined, so a cleared field is saved as cleared.
		if (person.person) {
			updatePerson(person.person.id, {
				email: editEmail.trim(),
				phone: editPhone.trim(),
				company: editCompany.trim(),
				title: editTitle.trim()
			});
		}
		isEditing = false;
	}

	function cancelEditing() {
		isEditing = false;
	}
</script>

<div class="profile k-card">
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
</div>

<style>
	.profile {
		overflow: hidden;
	}

	.metadata-section {
		padding: 0.625rem 0.75rem 0.75rem;
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
</style>
