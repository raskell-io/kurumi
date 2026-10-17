<script lang="ts">
	/**
	 * Per-note version history, reconstructed from the Automerge change log.
	 * Lists every point where the note's title/body/tags changed; selecting one
	 * previews it and offers a Restore (applied as a normal forward edit).
	 */
	import { getMemoryHistory, restoreMemoryVersion, type MemoryVersion } from '$lib/db';
	import { X, RotateCcw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface Props {
		memoryId: string;
		onClose?: () => void;
		onRestored?: () => void;
	}
	let { memoryId, onClose, onRestored }: Props = $props();

	// Snapshot the note's history when the modal opens. memoryId is stable for
	// the modal's lifetime, so deriving just avoids the "initial value" warning.
	let versions = $derived<MemoryVersion[]>(getMemoryHistory(memoryId));
	let selectedIndex = $state(0);
	let selected = $derived<MemoryVersion | null>(versions[selectedIndex] ?? null);
	let listRef: HTMLUListElement | undefined = $state();

	function focusEntry(i: number) {
		const el = listRef?.querySelector<HTMLButtonElement>(`[data-index="${i}"]`);
		el?.focus();
		el?.scrollIntoView({ block: 'nearest' });
	}

	function select(i: number) {
		if (versions.length === 0) return;
		selectedIndex = Math.max(0, Math.min(versions.length - 1, i));
		focusEntry(selectedIndex);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose?.();
		} else if (e.key === 'ArrowDown' || e.key === 'j') {
			e.preventDefault();
			select(selectedIndex + 1);
		} else if (e.key === 'ArrowUp' || e.key === 'k') {
			e.preventDefault();
			select(selectedIndex - 1);
		}
	}

	// Land keyboard focus on the version list so arrows work immediately
	onMount(() => focusEntry(0));

	function relativeTime(ts: number): string {
		if (!ts) return 'unknown time';
		const diff = Date.now() - ts;
		const min = Math.round(diff / 60000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		const days = Math.round(hr / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(ts).toLocaleDateString();
	}

	function fullTime(ts: number): string {
		return ts ? new Date(ts).toLocaleString() : '';
	}

	function doRestore() {
		if (!selected) return;
		restoreMemoryVersion(memoryId, {
			title: selected.title,
			bodyMarkdown: selected.bodyMarkdown,
			tags: selected.tags
		});
		onRestored?.();
		onClose?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="k-dialog-backdrop history-backdrop"
	onclick={() => onClose?.()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="version-history-title"
	tabindex="-1"
>
	<div class="k-dialog modal" onclick={(e) => e.stopPropagation()} role="document">
		<div class="header">
			<h2 id="version-history-title">Version history</h2>
			<button type="button" class="k-icon-btn" onclick={() => onClose?.()} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if versions.length === 0}
			<div class="empty">No edit history recorded for this note yet.</div>
		{:else}
			<div class="layout">
				<ul class="list" bind:this={listRef} aria-label="Versions">
					{#each versions as version, i (version.hash || version.index)}
						<li>
							<button
								type="button"
								class="k-row entry"
								class:focused={i === selectedIndex}
								data-index={i}
								aria-current={i === selectedIndex}
								onclick={() => (selectedIndex = i)}
							>
								<span class="entry-title">{version.title || 'Untitled'}</span>
								<span class="entry-time">
									{#if i === 0}<span class="k-badge k-badge-accent">Current</span>{/if}
									<span title={fullTime(version.time)}>{relativeTime(version.time)}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>

				<div class="preview">
					{#if selected}
						<div class="preview-title">{selected.title || 'Untitled'}</div>
						<div class="preview-meta">
							{fullTime(selected.time)}
							{#each selected.tags as tag}<span class="tag">#{tag}</span>{/each}
						</div>
						<pre class="body">{selected.bodyMarkdown || '(empty)'}</pre>
					{/if}
				</div>
			</div>
		{/if}

		<div class="footer">
			<span class="hint">
				{#if versions.length > 0 && selectedIndex === 0}
					This is the current version
				{:else if versions.length > 0}
					Restoring adds a new edit — nothing is lost
				{/if}
			</span>
			<div class="actions">
				<button type="button" class="k-btn k-btn-ghost" onclick={() => onClose?.()}>Close</button>
				{#if versions.length > 0}
					<button
						type="button"
						class="k-btn k-btn-primary"
						onclick={doRestore}
						disabled={selectedIndex === 0}
					>
						<RotateCcw class="h-3.5 w-3.5" /> Restore
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.history-backdrop {
		z-index: 200;
	}

	@media (min-width: 768px) {
		.history-backdrop {
			align-items: center;
			padding-top: 1rem;
		}
	}

	.modal {
		display: flex;
		flex-direction: column;
		max-width: 56rem;
		max-height: 88vh;
		overflow: hidden;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.header h2 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.empty {
		padding: 2.5rem 1.25rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.layout {
		display: grid;
		grid-template-columns: 15rem 1fr;
		flex: 1;
		min-height: 20rem;
		overflow: hidden;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0.375rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-right: 1px solid var(--color-border);
	}

	.entry {
		flex-direction: column;
		align-items: stretch;
		gap: 0.0625rem;
		width: 100%;
		text-align: left;
	}

	.entry:focus-visible {
		outline: none;
	}

	.entry-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
	}

	.entry-time {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.entry-time .k-badge {
		height: 1rem;
		font-size: 0.625rem;
	}

	.preview {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: 1rem 1.25rem;
		overflow: hidden;
	}

	.preview-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.preview-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		margin: 0.125rem 0 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.tag {
		color: var(--color-ref-tag, var(--color-accent));
	}

	.body {
		flex: 1;
		margin: 0;
		overflow: auto;
		color: var(--color-text);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem 0.625rem 1rem;
		border-top: 1px solid var(--color-border);
	}

	.hint {
		min-width: 0;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.actions {
		display: flex;
		flex-shrink: 0;
		gap: 0.5rem;
	}

	@media (max-width: 640px) {
		.layout {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		.list {
			max-height: 28vh;
			border-right: none;
			border-bottom: 1px solid var(--color-border);
		}

		.hint {
			display: none;
		}
	}
</style>
