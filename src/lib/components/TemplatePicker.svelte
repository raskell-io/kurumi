<script lang="ts">
	import {
		templates,
		addNote,
		applyTemplateVariables,
		templateHasVariable,
		type Template
	} from '$lib/db';
	import { goto } from '$app/navigation';
	import { Search, FileText, X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open = $bindable(), onClose }: Props = $props();

	// Store subscription
	let templatesData = $state<Template[]>([]);

	$effect(() => {
		const unsub = templates.subscribe((t) => {
			templatesData = t;
		});
		return unsub;
	});

	// Search state
	let searchQuery = $state('');
	let searchInput: HTMLInputElement | undefined = $state();

	// Title prompt state
	let showTitlePrompt = $state(false);
	let selectedTemplate = $state<Template | null>(null);
	let noteTitle = $state('');
	let titleInput: HTMLInputElement | undefined = $state();

	// Keyboard navigation
	let selectedIndex = $state(0);

	// Filtered templates
	let filteredTemplates = $derived.by(() => {
		if (!searchQuery.trim()) return templatesData;
		const query = searchQuery.toLowerCase();
		return templatesData.filter(
			(t) =>
				t.name.toLowerCase().includes(query) ||
				(t.description && t.description.toLowerCase().includes(query))
		);
	});

	// Focus search input when opened
	$effect(() => {
		if (open && searchInput) {
			setTimeout(() => searchInput?.focus(), 50);
		}
	});

	// Focus title input when shown
	$effect(() => {
		if (showTitlePrompt && titleInput) {
			setTimeout(() => titleInput?.focus(), 50);
		}
	});

	// Reset state when opening
	$effect(() => {
		if (open) {
			searchQuery = '';
			selectedIndex = 0;
			showTitlePrompt = false;
			selectedTemplate = null;
			noteTitle = '';
		}
	});

	function handleTemplateSelect(template: Template) {
		// Check if template has {title} variable
		if (templateHasVariable(template.content, 'title')) {
			selectedTemplate = template;
			noteTitle = '';
			showTitlePrompt = true;
		} else {
			createNoteFromTemplate(template);
		}
	}

	function createNoteFromTemplate(template: Template, title?: string) {
		const overrides: Record<string, string> = {};
		if (title) {
			overrides.title = title;
		}

		const content = applyTemplateVariables(template.content, overrides);
		const noteTitle = title || template.name;

		const note = addNote(noteTitle, content);
		onClose();
		goto(`/note/${note.id}`);
	}

	function handleTitleSubmit() {
		if (selectedTemplate && noteTitle.trim()) {
			createNoteFromTemplate(selectedTemplate, noteTitle.trim());
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;

		if (showTitlePrompt) {
			if (e.key === 'Escape') {
				showTitlePrompt = false;
				selectedTemplate = null;
			} else if (e.key === 'Enter') {
				handleTitleSubmit();
			}
			return;
		}

		switch (e.key) {
			case 'Escape':
				onClose();
				break;
			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, filteredTemplates.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, 0);
				break;
			case 'Enter':
				e.preventDefault();
				if (filteredTemplates[selectedIndex]) {
					handleTemplateSelect(filteredTemplates[selectedIndex]);
				}
				break;
		}
	}

	function handleBackdropClick() {
		if (showTitlePrompt) {
			showTitlePrompt = false;
			selectedTemplate = null;
		} else {
			onClose();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-lg rounded-xl bg-[var(--color-bg)] shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			{#if showTitlePrompt && selectedTemplate}
				<!-- Title prompt -->
				<div class="p-4">
					<div class="mb-4 flex items-center justify-between">
						<h2 class="text-lg font-semibold text-[var(--color-text)]">Enter note title</h2>
						<button
							onclick={() => {
								showTitlePrompt = false;
								selectedTemplate = null;
							}}
							class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
						>
							<X class="h-5 w-5" />
						</button>
					</div>
					<p class="mb-3 text-sm text-[var(--color-text-muted)]">
						The template "{selectedTemplate.name}" uses a title variable.
					</p>
					<input
						bind:this={titleInput}
						type="text"
						bind:value={noteTitle}
						placeholder="Note title"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					<div class="mt-4 flex justify-end gap-2">
						<button
							onclick={() => {
								showTitlePrompt = false;
								selectedTemplate = null;
							}}
							class="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]"
						>
							Cancel
						</button>
						<button
							onclick={handleTitleSubmit}
							disabled={!noteTitle.trim()}
							class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							Create Note
						</button>
					</div>
				</div>
			{:else}
				<!-- Template picker -->
				<div class="border-b border-[var(--color-border)] p-3">
					<div class="flex items-center gap-2">
						<Search class="h-5 w-5 text-[var(--color-text-muted)]" />
						<input
							bind:this={searchInput}
							type="text"
							bind:value={searchQuery}
							placeholder="Search templates..."
							class="flex-1 bg-transparent text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none"
						/>
						<button
							onclick={onClose}
							class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
						>
							<X class="h-5 w-5" />
						</button>
					</div>
				</div>

				<div class="max-h-80 overflow-y-auto p-2">
					{#if filteredTemplates.length === 0}
						<div class="p-4 text-center text-sm text-[var(--color-text-muted)]">
							{#if templatesData.length === 0}
								No templates yet. <a
									href="/templates"
									class="text-[var(--color-accent)] hover:underline">Create one</a
								>
							{:else}
								No templates match your search
							{/if}
						</div>
					{:else}
						{#each filteredTemplates as template, i (template.id)}
							<button
								onclick={() => handleTemplateSelect(template)}
								class="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors {i ===
								selectedIndex
									? 'bg-[var(--color-accent)]/10'
									: 'hover:bg-[var(--color-bg-secondary)]'}"
							>
								<FileText
									class="mt-0.5 h-5 w-5 flex-shrink-0 {i === selectedIndex
										? 'text-[var(--color-accent)]'
										: 'text-[var(--color-text-muted)]'}"
								/>
								<div class="min-w-0 flex-1">
									<div class="font-medium text-[var(--color-text)]">{template.name}</div>
									{#if template.description}
										<div class="truncate text-sm text-[var(--color-text-muted)]">
											{template.description}
										</div>
									{/if}
								</div>
							</button>
						{/each}
					{/if}
				</div>

				<div
					class="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
				>
					<span class="mr-3"><kbd class="rounded bg-[var(--color-border)] px-1">↑↓</kbd> Navigate</span
					>
					<span class="mr-3"><kbd class="rounded bg-[var(--color-border)] px-1">↵</kbd> Select</span>
					<span><kbd class="rounded bg-[var(--color-border)] px-1">Esc</kbd> Close</span>
				</div>
			{/if}
		</div>
	</div>
{/if}
