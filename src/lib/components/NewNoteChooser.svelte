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
		Plus,
		X,
		Calendar,
		Users,
		FolderKanban,
		Settings,
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
		return lines.join('\n');
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
<div class="backdrop" onclick={onClose} role="dialog" aria-modal="true" tabindex="-1">
	<div class="chooser" onclick={(e) => e.stopPropagation()} role="document">
		<div class="chooser-header">
			<h2>New note</h2>
			<button class="close-btn" onclick={onClose} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		<div class="chooser-body">
			<!-- Blank note card -->
			<button class="template-card blank" onclick={handleBlankNote}>
				<div class="card-icon">
					<FileText class="h-6 w-6" />
				</div>
				<div class="card-info">
					<span class="card-name">Blank note</span>
					<span class="card-desc">Start from scratch</span>
				</div>
			</button>

			<!-- Template cards -->
			{#each userTemplates as template (template.id)}
				{@const Icon = templateIcon(template.name)}
				<button
					class="template-card"
					onclick={() => handleTemplateSelect(template)}
				>
					<div class="card-icon">
						<Icon class="h-6 w-6" />
					</div>
					<div class="card-info">
						<span class="card-name">{template.name}</span>
						{#if template.description}
							<span class="card-desc">{template.description}</span>
						{:else}
							<span class="card-preview">{templatePreview(template.content)}</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		<div class="chooser-footer">
			<button class="manage-btn" onclick={handleManageTemplates}>
				<Settings class="h-3.5 w-3.5" />
				Manage templates
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
		animation: fade-in 0.12s ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.chooser {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 520px;
		width: 100%;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		animation: slide-up 0.15s ease-out;
	}

	@keyframes slide-up {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.chooser-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.chooser-header h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.close-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.close-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.chooser-body {
		padding: 0.75rem;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.5rem;
	}

	.template-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.625rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.12s;
	}

	.template-card:hover {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
	}

	.template-card.blank {
		border-style: dashed;
	}

	.template-card.blank:hover {
		border-style: solid;
	}

	.card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.template-card.blank .card-icon {
		background: var(--color-bg);
		color: var(--color-text-muted);
	}

	.card-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.card-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.card-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.35;
	}

	.card-preview {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		font-family: ui-monospace, monospace;
		white-space: pre-line;
		line-height: 1.3;
		max-height: 2.6em;
		overflow: hidden;
	}

	.chooser-footer {
		display: flex;
		justify-content: center;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.manage-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: none;
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.manage-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	@media (max-width: 480px) {
		.chooser-body {
			grid-template-columns: 1fr;
		}
	}
</style>
