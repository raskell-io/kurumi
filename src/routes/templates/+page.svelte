<script lang="ts">
	import { templates, addTemplate, updateTemplate, deleteTemplate, addStarterTemplates, type Template } from '$lib/db';
	import { Plus, FileText, Pencil, Trash2, X, Info, Sparkles } from 'lucide-svelte';

	// Store subscription for Svelte 5 runes mode
	let templatesData = $state<Template[]>([]);

	$effect(() => {
		const unsub = templates.subscribe((t) => {
			templatesData = t;
		});
		return unsub;
	});

	// Modal state
	let showEditor = $state(false);
	let editingTemplate = $state<Template | null>(null);
	let templateName = $state('');
	let templateDescription = $state('');
	let templateContent = $state('');

	// Delete confirmation
	let showDeleteConfirm = $state(false);
	let templateToDelete = $state<Template | null>(null);

	function openNewTemplate() {
		editingTemplate = null;
		templateName = '';
		templateDescription = '';
		templateContent = '';
		showEditor = true;
	}

	function openEditTemplate(template: Template) {
		editingTemplate = template;
		templateName = template.name;
		templateDescription = template.description || '';
		templateContent = template.content;
		showEditor = true;
	}

	function closeEditor() {
		showEditor = false;
		editingTemplate = null;
	}

	function saveTemplate() {
		if (!templateName.trim()) return;

		if (editingTemplate) {
			updateTemplate(editingTemplate.id, {
				name: templateName.trim(),
				description: templateDescription.trim() || undefined,
				content: templateContent
			});
		} else {
			addTemplate(templateName.trim(), templateContent, templateDescription.trim() || undefined);
		}
		closeEditor();
	}

	function confirmDelete(template: Template) {
		templateToDelete = template;
		showDeleteConfirm = true;
	}

	function handleDelete() {
		if (templateToDelete) {
			deleteTemplate(templateToDelete.id);
		}
		showDeleteConfirm = false;
		templateToDelete = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (showDeleteConfirm) {
				showDeleteConfirm = false;
				templateToDelete = null;
			} else if (showEditor) {
				closeEditor();
			}
		}
	}

	// Variables documentation
	const variables = [
		{ name: '{date}', desc: "Today's date (YYYY-MM-DD)" },
		{ name: '{time}', desc: 'Current time (HH:MM)' },
		{ name: '{datetime}', desc: 'Full date and time' },
		{ name: '{weekday}', desc: 'Day of the week' },
		{ name: '{month}', desc: 'Month name' },
		{ name: '{year}', desc: 'Current year' },
		{ name: '{vault}', desc: 'Current vault name' },
		{ name: '{title}', desc: 'Note title (prompted)' }
	];
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 md:px-6"
	>
		<h1 class="text-lg font-semibold text-[var(--color-text)]">Templates</h1>
		<button
			onclick={openNewTemplate}
			class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
		>
			<Plus class="h-4 w-4" />
			New Template
		</button>
	</header>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto bg-[var(--color-bg)] p-4 md:p-6">
		{#if templatesData.length === 0}
			<!-- Empty state -->
			<div class="flex h-full items-center justify-center">
				<div class="text-center">
					<FileText class="mx-auto mb-4 h-16 w-16 text-[var(--color-text-muted)]" />
					<p class="text-lg text-[var(--color-text-muted)]">No templates yet</p>
					<p class="mt-2 text-sm text-[var(--color-text-muted)]">
						Create templates to quickly start new notes with predefined content
					</p>
					<div class="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
						<button
							onclick={addStarterTemplates}
							class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
						>
							<Sparkles class="h-4 w-4" />
							Add starter templates
						</button>
						<button
							onclick={openNewTemplate}
							class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
						>
							Create from scratch
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Template grid -->
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each templatesData as template (template.id)}
					<div
						class="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 transition-colors hover:border-[var(--color-accent)]"
					>
						<div class="mb-2 flex items-start justify-between">
							<div class="flex items-center gap-2">
								<FileText class="h-5 w-5 text-[var(--color-accent)]" />
								<h3 class="font-medium text-[var(--color-text)]">{template.name}</h3>
							</div>
							<div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
								<button
									onclick={() => openEditTemplate(template)}
									class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
									title="Edit template"
								>
									<Pencil class="h-4 w-4" />
								</button>
								<button
									onclick={() => confirmDelete(template)}
									class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500"
									title="Delete template"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</div>
						{#if template.description}
							<p class="mb-2 text-sm text-[var(--color-text-muted)]">{template.description}</p>
						{/if}
						<pre
							class="max-h-24 overflow-hidden text-ellipsis rounded bg-[var(--color-bg)] p-2 text-xs text-[var(--color-text-muted)]">{template.content.slice(0, 200)}{template.content.length > 200 ? '...' : ''}</pre>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Template Editor Modal -->
{#if showEditor}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={closeEditor}
		onkeydown={(e) => e.key === 'Escape' && closeEditor()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-2xl rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold text-[var(--color-text)]">
					{editingTemplate ? 'Edit Template' : 'New Template'}
				</h2>
				<button
					onclick={closeEditor}
					class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-4">
				<!-- Name -->
				<div>
					<label for="template-name" class="mb-1 block text-sm font-medium text-[var(--color-text)]"
						>Name</label
					>
					<input
						id="template-name"
						type="text"
						bind:value={templateName}
						placeholder="e.g., Meeting Notes"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>

				<!-- Description -->
				<div>
					<label
						for="template-description"
						class="mb-1 block text-sm font-medium text-[var(--color-text)]">Description (optional)</label
					>
					<input
						id="template-description"
						type="text"
						bind:value={templateDescription}
						placeholder="Brief description of this template"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>

				<!-- Content -->
				<div>
					<label
						for="template-content"
						class="mb-1 block text-sm font-medium text-[var(--color-text)]">Content</label
					>
					<textarea
						id="template-content"
						bind:value={templateContent}
						placeholder="# {title}

**Date:** {date}

## Notes

"
						rows="10"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					></textarea>
				</div>

				<!-- Variables hint -->
				<div
					class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3"
				>
					<div class="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
						<Info class="h-4 w-4" />
						Available Variables
					</div>
					<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{#each variables as v}
							<div>
								<code class="text-[var(--color-accent)]">{v.name}</code>
								<span class="text-[var(--color-text-muted)]"> - {v.desc}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3">
				<button
					onclick={closeEditor}
					class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]"
				>
					Cancel
				</button>
				<button
					onclick={saveTemplate}
					disabled={!templateName.trim()}
					class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{editingTemplate ? 'Save Changes' : 'Create Template'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm && templateToDelete}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-sm rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-2 text-lg font-semibold text-[var(--color-text)]">Delete Template?</h2>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Are you sure you want to delete "{templateToDelete.name}"? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-3">
				<button
					onclick={() => (showDeleteConfirm = false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]"
				>
					Cancel
				</button>
				<button
					onclick={handleDelete}
					class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
				>
					Delete
				</button>
			</div>
		</div>
	</div>
{/if}
