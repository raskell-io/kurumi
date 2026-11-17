<script lang="ts">
	import { stashEdit } from '$lib/unsaved';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { memoryObjects, addMemoryObject, updateMemoryObject, vaultLinkResolver, currentVaultCaps } from '$lib/db';
	import { isLinkedNoteId } from '$lib/linked/backend';
	import { NO_NEW_NOTES } from '$lib/linked/capabilities';
	import { showNotice } from '$lib/stores/notice';
	import { closeSplit, openInSplit } from '$lib/stores/workspace';
	import Editor from './Editor.svelte';
	import NoteIcon from './NoteIcon.svelte';
	import { autogrow } from '$lib/actions/autogrow';
	import { singleLine } from '$lib/actions/single-line';
	import { ArrowUpLeft, X } from 'lucide-svelte';

	// Second note next to the main one (split view). A compact editor:
	// title + body, saved like the main note page. Links clicked here open
	// in this pane.
	let { noteId }: { noteId: string } = $props();

	let memory = $derived($memoryObjects.find((m) => m.id === noteId));
	// A linked folder's note is shown, never saved.
	let readOnly = $derived(!!memory && isLinkedNoteId(memory.id));

	let title = $state('');
	let content = $state('');
	let revision = $state(0);
	let pending: { id: string; title: string; content: string } | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let lastKeyAt = 0;
	// The editor mounts only once this matches the note, i.e. after its
	// content is loaded; mounting with stale or empty content would save
	// that over the note on the first keystroke.
	let loadedFor = $state('');

	// Load when the pane switches notes, and pick up outside changes
	// (e.g. the same text edited in the main pane) unless we're mid-edit.
	$effect(() => {
		const m = memory;
		untrack(() => {
			if (!m) return;
			if (m.id !== loadedFor) {
				flush();
				loadedFor = m.id;
				title = m.title === 'Untitled' ? '' : m.title;
				content = m.bodyMarkdown;
				return; // the editor's {#key} includes the id, so it remounts itself
			}
			if (!pending && m.bodyMarkdown !== content && Date.now() - lastKeyAt > 1500) {
				content = m.bodyMarkdown;
				revision++;
			}
		});
	});

	function flush() {
		clearTimeout(saveTimer);
		if (pending) {
			updateMemoryObject(pending.id, { title: pending.title, bodyMarkdown: pending.content });
			pending = null;
		}
	}

	function scheduleSave() {
		if (!memory || readOnly) return;
		pending = { id: memory.id, title: title.trim() || 'Untitled', content };
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 300);
	}

	function handleContentChange(markdown: string, changedId?: string) {
		if (changedId && changedId !== memory?.id) return;
		if (markdown === content) return;
		content = markdown;
		scheduleSave();
	}

	function handleWikilink(linkTitle: string) {
		const target = vaultLinkResolver($memoryObjects).resolve(linkTitle);
		if (!target && !$currentVaultCaps.createNotes) {
			showNotice(NO_NEW_NOTES);
			return;
		}
		openInSplit(target ? target.id : addMemoryObject(linkTitle, '').id);
	}

	function openInMain() {
		if (!memory) return;
		flush();
		const id = memory.id;
		closeSplit();
		goto(`/memory/${id}`);
	}

	$effect(() => () => flush());

	// The page can reload under us (e.g. a file or share opening in this
	// window); save first.
	$effect(() => {
		const save = () => {
			if (pending) stashEdit(pending.id, pending.title, pending.content);
			flush();
		};
		window.addEventListener('pagehide', save);
		return () => window.removeEventListener('pagehide', save);
	});
</script>

<section class="split-pane" aria-label="Split view">
	<header class="split-header">
		{#if memory}
			<NoteIcon icon={memory.icon} class="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
			<span class="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--color-text)]">{memory.title || 'Untitled'}</span>
		{:else}
			<span class="flex-1"></span>
		{/if}
		<button class="k-icon-btn" onclick={openInMain} title="Open in main pane" aria-label="Open in main pane">
			<ArrowUpLeft class="h-4 w-4" />
		</button>
		<button class="k-icon-btn" onclick={() => { flush(); closeSplit(); }} title="Close split" aria-label="Close split view">
			<X class="h-4 w-4" />
		</button>
	</header>

	{#if memory}
		<div class="split-scroll" onkeydowncapture={() => (lastKeyAt = Date.now())} role="presentation">
			<!-- Like the main title: one line that wraps and grows. -->
			<textarea
				rows="1"
				bind:value={title}
				use:singleLine
				use:autogrow={title}
				oninput={scheduleSave}
				onkeydown={(e) => {
					// Enter goes into the note, as in the main pane.
					if (e.key !== 'Enter' || e.isComposing) return;
					e.preventDefault();
					(e.currentTarget.parentElement?.querySelector('.ProseMirror') as HTMLElement | null)?.focus();
				}}
				placeholder="Untitled"
				disabled={readOnly}
				aria-label="Split note title"
				class="split-title k-autogrow"
				style="font-family: var(--font-editor);"
			></textarea>
			{#key `${memory.id}-${revision}`}
				{#if loadedFor === memory.id}
				<Editor
					{content}
					noteId={memory.id}
					currentFolderId={memory.folderId}
					readonly={readOnly}
					onchange={handleContentChange}
					onWikilinkClick={handleWikilink}
					secondary
				/>
				{/if}
			{/key}
		</div>
	{:else}
		<p class="p-6 text-sm text-[var(--color-text-muted)]">This note was deleted.</p>
	{/if}
</section>

<style>
	.split-pane {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		border-left: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	.split-header {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.375rem;
		padding: 0 0.5rem 0 1rem;
	}

	.split-scroll {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1.5rem 2rem 3rem;
	}

	.split-title,
	.split-title:focus,
	.split-title:focus-visible {
		display: block;
		width: 100%;
		margin-bottom: 1rem;
		border: none !important;
		background: transparent;
		color: var(--color-text);
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1.2;
		overflow-wrap: break-word;
		outline: none !important;
		box-shadow: none !important;
	}

	.split-title::placeholder {
		color: var(--color-text-faint);
	}
</style>
