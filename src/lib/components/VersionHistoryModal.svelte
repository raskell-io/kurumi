<script lang="ts">
	/**
	 * Per-note version history, reconstructed from the Automerge change log.
	 * Lists every point where the note's title/body/tags changed; selecting one
	 * previews it and offers a Restore (applied as a normal forward edit).
	 */
	import { getMemoryHistory, restoreMemoryVersion, type MemoryVersion } from '$lib/db';
	import { History, X, RotateCcw } from 'lucide-svelte';

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
	let confirmingRestore = $state(false);

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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" onclick={() => onClose?.()} role="dialog" aria-modal="true" tabindex="-1">
	<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
		<div class="header">
			<div class="title">
				<History class="h-5 w-5 text-[var(--color-accent)]" />
				<h3>Version history</h3>
			</div>
			<button class="close" onclick={() => onClose?.()} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if versions.length === 0}
			<div class="empty">No edit history recorded for this note yet.</div>
		{:else}
			<div class="layout">
				<ul class="list">
					{#each versions as version, i (version.hash || version.index)}
						<li>
							<button
								class="entry"
								class:active={i === selectedIndex}
								onclick={() => {
									selectedIndex = i;
									confirmingRestore = false;
								}}
							>
								<span class="entry-time">
									{relativeTime(version.time)}
									{#if i === 0}<span class="badge">current</span>{/if}
								</span>
								<span class="entry-title">{version.title || 'Untitled'}</span>
							</button>
						</li>
					{/each}
				</ul>

				<div class="preview">
					{#if selected}
						<div class="preview-header">
							<div>
								<div class="preview-title">{selected.title || 'Untitled'}</div>
								<div class="preview-meta">{fullTime(selected.time)}</div>
							</div>
							{#if selectedIndex !== 0}
								{#if confirmingRestore}
									<div class="confirm">
										<span>Restore this version?</span>
										<button class="restore-btn" onclick={doRestore}>
											<RotateCcw class="h-4 w-4" /> Confirm
										</button>
										<button class="ghost-btn" onclick={() => (confirmingRestore = false)}>
											Cancel
										</button>
									</div>
								{:else}
									<button class="restore-btn" onclick={() => (confirmingRestore = true)}>
										<RotateCcw class="h-4 w-4" /> Restore
									</button>
								{/if}
							{:else}
								<span class="current-note">This is the current version</span>
							{/if}
						</div>
						{#if selected.tags.length > 0}
							<div class="tags">
								{#each selected.tags as tag}<span class="tag">#{tag}</span>{/each}
							</div>
						{/if}
						<pre class="body">{selected.bodyMarkdown || '(empty)'}</pre>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
		padding: 1rem;
	}
	.modal {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 900px;
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.title h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}
	.close {
		background: none;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.empty {
		padding: 2.5rem 1.25rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	.layout {
		display: grid;
		grid-template-columns: 16rem 1fr;
		gap: 0;
		overflow: hidden;
		min-height: 20rem;
	}
	@media (max-width: 640px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		overflow-y: auto;
		max-height: 70vh;
		border-right: 1px solid var(--color-border);
	}
	.entry {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.625rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text);
	}
	.entry:hover {
		background: var(--color-bg-secondary);
	}
	.entry.active {
		background: var(--color-bg-secondary);
		outline: 1px solid var(--color-accent);
	}
	.entry-time {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.badge {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: 0.25rem;
		padding: 0 0.25rem;
	}
	.entry-title {
		font-size: 0.8125rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preview {
		display: flex;
		flex-direction: column;
		padding: 1rem 1.25rem;
		overflow: hidden;
	}
	.preview-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.preview-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}
	.preview-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.125rem;
	}
	.current-note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.confirm {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
	}
	.restore-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4375rem 0.75rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}
	.restore-btn:hover {
		background: var(--color-accent-hover);
	}
	.ghost-btn {
		padding: 0.4375rem 0.625rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: var(--color-text);
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}
	.tag {
		font-size: 0.75rem;
		color: var(--color-accent);
	}
	.body {
		flex: 1;
		overflow: auto;
		max-height: 60vh;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.75rem;
		color: var(--color-text);
		font-family: ui-monospace, monospace;
		font-size: 0.8125rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-wrap: break-word;
		margin: 0;
	}
</style>
