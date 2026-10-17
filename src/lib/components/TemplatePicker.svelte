<script lang="ts">
	import {
		templates,
		addMemoryObject,
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

	// Keep the cursor in range as the filter narrows
	$effect(() => {
		void searchQuery;
		selectedIndex = 0;
	});

	// Keep the keyboard-selected row in view
	let listRef: HTMLDivElement | undefined = $state();
	$effect(() => {
		const el = listRef?.querySelector(`[data-index="${selectedIndex}"]`);
		el?.scrollIntoView({ block: 'nearest' });
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

		const memory = addMemoryObject(noteTitle, content);
		onClose();
		goto(`/memory/${memory.id}`);
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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={showTitlePrompt ? 'Name the new note' : 'New note from template'}
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="k-dialog flex !max-w-lg flex-col !overflow-hidden" onclick={(e) => e.stopPropagation()}>
			{#if showTitlePrompt && selectedTemplate}
				<!-- Title prompt -->
				<div class="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
					<h2 class="text-sm font-semibold text-[var(--color-text)]">Name your note</h2>
					<button
						type="button"
						onclick={() => {
							showTitlePrompt = false;
							selectedTemplate = null;
						}}
						class="k-icon-btn"
						aria-label="Back to templates"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="px-4 pb-4">
					<p class="mb-3 text-xs text-[var(--color-text-muted)]">
						“{selectedTemplate.name}” uses the note title in its body.
					</p>
					<input
						bind:this={titleInput}
						type="text"
						bind:value={noteTitle}
						placeholder="Note title"
						aria-label="Note title"
						class="k-input"
					/>
				</div>
				<div class="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
					<button
						type="button"
						onclick={() => {
							showTitlePrompt = false;
							selectedTemplate = null;
						}}
						class="k-btn k-btn-ghost"
					>
						Back
					</button>
					<button
						type="button"
						onclick={handleTitleSubmit}
						disabled={!noteTitle.trim()}
						class="k-btn k-btn-primary"
					>
						Create note
					</button>
				</div>
			{:else}
				<!-- Template picker -->
				<div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
					<Search class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
					<input
						bind:this={searchInput}
						type="text"
						bind:value={searchQuery}
						placeholder="Search templates…"
						aria-label="Search templates"
						class="picker-input h-12 flex-1 bg-transparent text-[0.9375rem] text-[var(--color-text)] placeholder-[var(--color-text-faint)]"
					/>
					<button type="button" onclick={onClose} class="k-icon-btn" aria-label="Close">
						<X class="h-4 w-4" />
					</button>
				</div>

				<div class="max-h-80 overflow-y-auto overscroll-contain p-1.5" bind:this={listRef}>
					{#if filteredTemplates.length === 0}
						<div class="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
							{#if templatesData.length === 0}
								No templates yet. <a
									href="/templates"
									onclick={onClose}
									class="text-[var(--color-accent)] hover:underline">Create one</a
								>
							{:else}
								No templates match your search
							{/if}
						</div>
					{:else}
						{#each filteredTemplates as template, i (template.id)}
							<button
								type="button"
								data-index={i}
								onclick={() => handleTemplateSelect(template)}
								onmousemove={() => { if (selectedIndex !== i) selectedIndex = i; }}
								class="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left"
								class:bg-[var(--color-hover)]={i === selectedIndex}
							>
								<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm text-[var(--color-text)]">{template.name}</div>
									{#if template.description}
										<div class="truncate text-xs text-[var(--color-text-faint)]">
											{template.description}
										</div>
									{/if}
								</div>
								{#if i === selectedIndex}
									<span class="k-kbd hidden shrink-0 md:inline-flex">↵</span>
								{/if}
							</button>
						{/each}
					{/if}
				</div>

				<div
					class="hidden items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-faint)] md:flex"
				>
					<span class="flex items-center gap-1.5"><span class="k-kbd">↑</span><span class="k-kbd">↓</span> navigate</span>
					<span class="flex items-center gap-1.5"><span class="k-kbd">↵</span> select</span>
					<span class="flex items-center gap-1.5"><span class="k-kbd">esc</span> close</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.picker-input,
	.picker-input:focus,
	.picker-input:focus-visible {
		border: none;
		outline: none;
		box-shadow: none;
	}
</style>
