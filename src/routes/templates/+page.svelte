<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
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

	let editorEl: HTMLFormElement | undefined = $state();
	const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

	// Bring the inline editor into view when it opens (e.g. editing a row far down the list)
	$effect(() => {
		if (showEditor && editorEl) editorEl.scrollIntoView({ block: 'nearest' });
	});

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

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>Templates - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Templates</h1>
			<p class="k-page-subtitle">Reusable starting points for new notes.</p>
		</div>
		{#if templatesData.length > 0 && !showEditor}
			<button onclick={openNewTemplate} class="k-btn k-btn-primary shrink-0">
				<Plus class="h-4 w-4" />
				New template
			</button>
		{/if}
	</header>

	{#if showEditor}
		<!-- Inline template editor (Cmd/Ctrl+Enter saves) -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			bind:this={editorEl}
			class="k-card mb-8 p-4 md:p-5"
			aria-labelledby="template-editor-title"
			onsubmit={(e) => {
				e.preventDefault();
				saveTemplate();
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					saveTemplate();
				}
			}}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 id="template-editor-title" class="text-sm font-semibold text-[var(--color-text)]">
					{editingTemplate ? 'Edit template' : 'New template'}
				</h2>
				<button type="button" onclick={closeEditor} class="k-icon-btn" aria-label="Close editor">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="template-name" class="k-label">Name</label>
						<input
							id="template-name"
							type="text"
							bind:value={templateName}
							placeholder="e.g., Meeting Notes"
							class="k-input"
							use:autofocus
						/>
					</div>
					<div>
						<label for="template-description" class="k-label">
							Description <span class="font-normal text-[var(--color-text-faint)]">(optional)</span>
						</label>
						<input
							id="template-description"
							type="text"
							bind:value={templateDescription}
							placeholder="Brief description"
							class="k-input"
						/>
					</div>
				</div>

				<div>
					<label for="template-content" class="k-label">Content</label>
					<textarea
						id="template-content"
						bind:value={templateContent}
						placeholder={'# {title}\n\n**Date:** {date}\n\n## Notes\n\n'}
						rows="10"
						class="k-input font-mono !text-[0.8125rem]"
					></textarea>
				</div>

				<details class="group text-xs">
					<summary class="flex cursor-pointer select-none items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
						<Info class="h-3.5 w-3.5" />
						Available variables
					</summary>
					<dl class="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
						{#each variables as v}
							<div class="flex gap-2">
								<dt><code class="text-[var(--color-accent)]">{v.name}</code></dt>
								<dd class="text-[var(--color-text-muted)]">{v.desc}</dd>
							</div>
						{/each}
					</dl>
				</details>
			</div>

			<div class="mt-5 flex items-center justify-end gap-2">
				<span class="mr-auto text-xs text-[var(--color-text-faint)] max-sm:hidden">
					<kbd class="k-kbd">{modKey}↵</kbd> to save
				</span>
				<button type="button" onclick={closeEditor} class="k-btn k-btn-ghost">Cancel</button>
				<button type="submit" disabled={!templateName.trim()} class="k-btn k-btn-primary">
					{editingTemplate ? 'Save' : 'Create template'}
				</button>
			</div>
		</form>
	{/if}

	{#if templatesData.length === 0}
		{#if !showEditor}
			<div class="k-empty">
				<FileText />
				<p class="k-empty-title">No templates yet</p>
				<p>Start new notes from predefined content.</p>
				<div class="mt-2 flex flex-col items-center gap-2 sm:flex-row">
					<button onclick={addStarterTemplates} class="k-btn k-btn-primary">
						<Sparkles class="h-4 w-4" />
						Add starter templates
					</button>
					<button onclick={openNewTemplate} class="k-btn k-btn-ghost">Create from scratch</button>
				</div>
			</div>
		{/if}
	{:else}
		<ul>
			{#each templatesData as template (template.id)}
				<li
					class="k-row group !items-start py-2"
					class:selected={editingTemplate?.id === template.id}
				>
					<FileText class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
					<button
						type="button"
						onclick={() => openEditTemplate(template)}
						class="min-w-0 flex-1 text-left"
					>
						<span class="block truncate font-medium">{template.name}</span>
						<span class="block truncate text-xs text-[var(--color-text-faint)]">
							{template.description || template.content.split('\n').find((l) => l.trim()) || 'Empty template'}
						</span>
					</button>
					<div class="row-actions flex shrink-0 items-center gap-0.5">
						<button
							onclick={() => openEditTemplate(template)}
							class="k-icon-btn"
							title="Edit template"
							aria-label="Edit {template.name}"
						>
							<Pencil class="h-4 w-4" />
						</button>
						<button
							onclick={() => confirmDelete(template)}
							class="k-icon-btn hover:!text-[var(--color-danger)]"
							title="Delete template"
							aria-label="Delete {template.name}"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- Delete Confirmation Modal (hard delete, no undo) -->
{#if showDeleteConfirm && templateToDelete}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
		role="dialog"
		aria-modal="true"
		aria-labelledby="template-delete-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="k-dialog !max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h2 id="template-delete-title" class="text-base font-semibold text-[var(--color-text)]">Delete template?</h2>
			<p class="mt-2 text-sm text-[var(--color-text-muted)]">
				"{templateToDelete.name}" will be deleted. This can't be undone.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={() => (showDeleteConfirm = false)} class="k-btn k-btn-ghost">Cancel</button>
				<button onclick={handleDelete} class="k-btn k-btn-danger" use:autofocus>Delete</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Row actions reveal on hover/focus; always visible on touch */
	.row-actions {
		opacity: 0;
	}

	:global(.k-row:hover) > .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}

	@media (hover: none) {
		.row-actions {
			opacity: 1;
		}
	}
</style>
