<script lang="ts">
	/**
	 * Hover preview for [[wikilinks]] (Obsidian-style page preview).
	 *
	 * Listens for pointer hovers on `.wikilink` decorations inside `container`
	 * and, after a short intent delay, shows the target note's title, folder,
	 * last-edited time and opening text. Moving the pointer onto the card keeps
	 * it open so the "Open" action is reachable.
	 */
	import { memoryObjects, folders } from '$lib/db';
	import { FileText, FilePlus } from 'lucide-svelte';
	import type { MemoryObject } from '$lib/db/types';

	interface Props {
		container: HTMLElement | undefined;
		onOpen: (title: string) => void;
	}

	let { container, onOpen }: Props = $props();

	const OPEN_DELAY_MS = 350;
	const CLOSE_DELAY_MS = 150;
	const CARD_WIDTH = 340;

	let linkTitle = $state<string | null>(null);
	let position = $state<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: false });
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	let target = $derived.by((): MemoryObject | null => {
		if (!linkTitle) return null;
		const wanted = linkTitle.toLowerCase();
		return $memoryObjects.find((m) => (m.title || '').toLowerCase() === wanted) ?? null;
	});

	let folderName = $derived(
		target?.folderId ? ($folders.find((f) => f.id === target!.folderId)?.name ?? null) : null
	);

	// Plain-text excerpt: drop frontmatter and the most common markdown syntax.
	let excerpt = $derived.by(() => {
		if (!target) return '';
		const text = (target.summaryShort || target.bodyMarkdown || '')
			.replace(/^---[\s\S]*?---\s*/, '')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/[*_`>~]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		return text.length > 280 ? text.slice(0, 280).trimEnd() + '…' : text;
	});

	function formatEdited(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function clearTimers() {
		if (openTimer) clearTimeout(openTimer);
		if (closeTimer) clearTimeout(closeTimer);
		openTimer = closeTimer = null;
	}

	function scheduleClose() {
		if (openTimer) clearTimeout(openTimer);
		openTimer = null;
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => (linkTitle = null), CLOSE_DELAY_MS);
	}

	function show(el: HTMLElement) {
		const title = el.dataset.wikilinkTitle?.split('|')[0].trim();
		if (!title) return;
		const rect = el.getBoundingClientRect();
		const above = rect.bottom + 220 > window.innerHeight;
		position = {
			left: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8)),
			top: above ? rect.top - 8 : rect.bottom + 8,
			above
		};
		linkTitle = title;
	}

	$effect(() => {
		const root = container;
		if (!root) return;
		// No hover on touch devices; a tap already navigates.
		if (!window.matchMedia('(hover: hover)').matches) return;

		const onOver = (e: PointerEvent) => {
			const el = (e.target as HTMLElement).closest<HTMLElement>('.wikilink');
			if (!el) return;
			clearTimers();
			openTimer = setTimeout(() => show(el), linkTitle ? 0 : OPEN_DELAY_MS);
		};
		const onOut = (e: PointerEvent) => {
			const from = (e.target as HTMLElement).closest('.wikilink');
			const to = (e.relatedTarget as HTMLElement | null)?.closest?.('.wikilink');
			if (from && from !== to) scheduleClose();
		};
		// Typing or scrolling dismisses the card immediately.
		const dismiss = () => {
			clearTimers();
			linkTitle = null;
		};

		root.addEventListener('pointerover', onOver);
		root.addEventListener('pointerout', onOut);
		root.addEventListener('keydown', dismiss);
		window.addEventListener('scroll', dismiss, true);
		return () => {
			clearTimers();
			root.removeEventListener('pointerover', onOver);
			root.removeEventListener('pointerout', onOut);
			root.removeEventListener('keydown', dismiss);
			window.removeEventListener('scroll', dismiss, true);
		};
	});
</script>

{#if linkTitle}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="link-preview"
		class:above={position.above}
		style="left: {position.left}px; top: {position.top}px; width: {CARD_WIDTH}px;"
		role="tooltip"
		onpointerenter={clearTimers}
		onpointerleave={scheduleClose}
	>
		{#if target}
			<div class="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
				<FileText class="h-3.5 w-3.5" />
				{#if folderName}<span class="truncate">{folderName}</span><span>·</span>{/if}
				<span class="shrink-0">Edited {formatEdited(target.updatedAt)}</span>
			</div>
			<div class="mt-1.5 truncate text-sm font-semibold text-[var(--color-text)]">
				{target.title || 'Untitled'}
			</div>
			{#if excerpt}
				<p class="mt-1 line-clamp-4 text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">{excerpt}</p>
			{:else}
				<p class="mt-1 text-[0.8125rem] italic text-[var(--color-text-faint)]">Empty note</p>
			{/if}
			<button class="open-btn" onclick={() => { const t = linkTitle!; linkTitle = null; onOpen(t); }}>
				Open note
			</button>
		{:else}
			<div class="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
				<FilePlus class="h-4 w-4 text-[var(--color-text-faint)]" />
				<span class="min-w-0 truncate">No note called “{linkTitle}” yet</span>
			</div>
			<button class="open-btn" onclick={() => { const t = linkTitle!; linkTitle = null; onOpen(t); }}>
				Create it
			</button>
		{/if}
	</div>
{/if}

<style>
	.link-preview {
		position: fixed;
		z-index: 70;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		animation: preview-in 120ms var(--ease-out);
	}

	.link-preview.above {
		transform: translateY(-100%);
		animation-name: preview-in-above;
	}

	.open-btn {
		margin-top: 0.625rem;
		padding: 0.1875rem 0.5rem;
		margin-left: -0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-accent);
	}

	.open-btn:hover {
		background: var(--color-accent-soft);
	}

	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	@keyframes preview-in-above {
		from {
			opacity: 0;
			transform: translateY(calc(-100% - 4px));
		}
	}
</style>
