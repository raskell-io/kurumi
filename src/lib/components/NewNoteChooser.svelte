<script lang="ts">
	import {
		templates,
		addMemoryObject,
		applyTemplateVariables,
		templateHasVariable,
		type Template
	} from '$lib/db';
	import { goto } from '$app/navigation';
	import { showNewNoteSnackbar } from '$lib/stores/snackbar';
	import {
		FileText,
		X,
		Calendar,
		Users,
		FolderKanban,
		Settings2,
		Sparkles
	} from 'lucide-svelte';

	interface Props {
		folderId?: string | null;
		onClose: () => void;
	}

	let { folderId = null, onClose }: Props = $props();

	// Blank note always first, then user templates
	let userTemplates = $derived($templates);

	// Categorize built-in names for icons
	function templateIcon(name: string) {
		const lower = name.toLowerCase();
		if (lower.includes('daily') || lower.includes('journal')) return Calendar;
		if (lower.includes('meeting')) return Users;
		if (lower.includes('project')) return FolderKanban;
		return Sparkles;
	}

	function templatePreview(content: string): string {
		// Show first 2-3 lines of the template as a preview
		const lines = content
			.split('\n')
			.filter((l) => l.trim())
			.slice(0, 3)
			.map((l) => l.replace(/\{(\w+)\}/g, '·'));
		return lines.join(' — ');
	}

	function handleBlankNote() {
		const memory = addMemoryObject(undefined, undefined, folderId);
		goto(`/memory/${memory.id}`);
		showNewNoteSnackbar.set(true);
		onClose();
	}

	function handleTemplateSelect(template: Template) {
		const needsTitle = templateHasVariable(template.content, 'title');

		if (needsTitle) {
			const title = prompt('Note title:');
			if (title === null) return; // Cancelled
			createFromTemplate(template, title || 'Untitled');
		} else {
			createFromTemplate(template);
		}
	}

	function createFromTemplate(template: Template, title?: string) {
		const overrides: Record<string, string> = {};
		if (title) overrides.title = title;

		const body = applyTemplateVariables(template.content, overrides);
		const noteTitle = title || template.name;

		const memory = addMemoryObject(noteTitle, body, folderId);
		goto(`/memory/${memory.id}`);
		showNewNoteSnackbar.set(true);
		onClose();
	}

	function handleManageTemplates() {
		onClose();
		goto('/templates');
	}

	// Blank note is the primary choice: focus it so Enter creates one
	let blankRef: HTMLButtonElement | undefined = $state();
	$effect(() => {
		blankRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="k-dialog-backdrop"
	onclick={onClose}
	role="dialog"
	aria-modal="true"
	aria-labelledby="new-note-title"
	tabindex="-1"
>
	<div class="k-dialog chooser" onclick={(e) => e.stopPropagation()} role="document">
		<div class="chooser-header">
			<h2 id="new-note-title">New note</h2>
			<button type="button" class="k-icon-btn" onclick={onClose} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		<div class="chooser-body">
			<button type="button" class="k-row option" bind:this={blankRef} onclick={handleBlankNote}>
				<FileText class="option-icon h-4 w-4" />
				<span class="option-info">
					<span class="option-name">Blank note</span>
					<span class="option-desc">Start from scratch</span>
				</span>
			</button>

			{#if userTemplates.length > 0}
				<div class="k-menu-label">Templates</div>
			{/if}
			{#each userTemplates as template (template.id)}
				{@const Icon = templateIcon(template.name)}
				<button type="button" class="k-row option" onclick={() => handleTemplateSelect(template)}>
					<Icon class="option-icon h-4 w-4" />
					<span class="option-info">
						<span class="option-name">{template.name}</span>
						<span class="option-desc">{template.description || templatePreview(template.content)}</span>
					</span>
				</button>
			{/each}
		</div>

		<div class="chooser-footer">
			<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={handleManageTemplates}>
				<Settings2 class="h-3.5 w-3.5" />
				Manage templates
			</button>
		</div>
	</div>
</div>

<style>
	.chooser {
		display: flex;
		flex-direction: column;
		max-width: 30rem;
		overflow: hidden;
	}

	.chooser-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.625rem 0.25rem 1rem;
	}

	.chooser-header h2 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.chooser-body {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0.375rem 0.5rem;
	}

	.option {
		width: 100%;
		text-align: left;
	}

	.option:focus-visible {
		outline: none;
		background: var(--color-hover);
	}

	.option :global(.option-icon) {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.option-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.option-name {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.option-desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.chooser-footer {
		padding: 0.375rem 0.5rem;
		border-top: 1px solid var(--color-border);
	}
</style>
