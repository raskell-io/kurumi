<script lang="ts">
	import { Calendar } from 'lucide-svelte';
	import { placePopup } from '$lib/editor/datePeopleAutocomplete';

	interface Props {
		position: { x: number; y: number; top?: number };
		query: string;
		onSelect: (date: string) => void;
		onClose: () => void;
	}

	let { position, query, onSelect, onClose }: Props = $props();

	let selectedIndex = $state(0);
	let popupWidth = $state(0);
	let popupHeight = $state(0);

	const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

	function toIso(date: Date): string {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function addDays(base: Date, days: number): Date {
		const next = new Date(base);
		next.setDate(next.getDate() + days);
		return next;
	}

	// Named shortcuts plus the next occurrence of each weekday. Typing after
	// `//` filters these by prefix ("tom", "fri", "next w"); a partial ISO
	// date ("2026-1") filters by date prefix instead.
	let candidates = $derived.by(() => {
		const today = new Date();
		const nextMonth = new Date(today);
		nextMonth.setMonth(nextMonth.getMonth() + 1);
		const list = [
			{ label: 'Today', date: toIso(today) },
			{ label: 'Tomorrow', date: toIso(addDays(today, 1)) },
			{ label: 'Yesterday', date: toIso(addDays(today, -1)) },
			{ label: 'Next week', date: toIso(addDays(today, 7)) },
			{ label: 'Next month', date: toIso(nextMonth) }
		];
		for (let i = 2; i <= 7; i++) {
			const day = addDays(today, i);
			const name = WEEKDAYS[day.getDay()];
			list.push({ label: name.charAt(0).toUpperCase() + name.slice(1), date: toIso(day) });
		}
		return list;
	});

	let options = $derived.by(() => {
		const q = query.toLowerCase().trim();
		const matches = q
			? candidates.filter((c) => c.label.toLowerCase().startsWith(q) || c.date.startsWith(q)).slice(0, 8)
			: candidates.slice(0, 5);
		return matches.map((c) => ({ value: c.date, label: c.label }));
	});

	$effect(() => {
		// Reset selection whenever the typed query changes
		void query;
		selectedIndex = 0;
	});

	// The caret stays in the editor while this is open, so navigation keys
	// are intercepted before ProseMirror sees them. Everything else keeps
	// typing into the document, which updates `query`.
	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
			if (handleKey(e.key)) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	function handleKey(key: string): boolean {
		switch (key) {
			case 'Escape':
				onClose();
				return true;
			case 'ArrowDown':
				if (options.length === 0) return false;
				selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
				return true;
			case 'ArrowUp':
				if (options.length === 0) return false;
				selectedIndex = Math.max(selectedIndex - 1, 0);
				return true;
			case 'Enter':
			case 'Tab':
				// Nothing to pick: let the key reach the editor
				if (options.length === 0) return false;
				onSelect(options[Math.min(selectedIndex, options.length - 1)].value);
				return true;
		}
		return false;
	}

	function formatDisplayDate(dateStr: string): string {
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div
	class="popup"
	style={placePopup(position, popupWidth, popupHeight)}
	bind:offsetWidth={popupWidth}
	bind:offsetHeight={popupHeight}
	role="listbox"
	aria-label="Insert date"
>
	<div class="header">
		<span>Date</span>
		{#if query.trim()}
			<span class="query">· {query}</span>
		{/if}
	</div>

	<div class="results">
		{#if options.length === 0}
			<div class="empty">
				<span>Keep typing YYYY-MM-DD</span>
			</div>
		{:else}
			{#each options as option, i (option.value + option.label)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					role="option"
					aria-selected={i === selectedIndex}
					onmousedown={(e) => {
						// Keep the editor's focus and selection intact
						e.preventDefault();
						onSelect(option.value);
					}}
					onmouseenter={() => (selectedIndex = i)}
					tabindex="-1"
				>
					<Calendar class="h-4 w-4 shrink-0 text-[var(--color-ref-date)]" />
					<span class="item-name">{option.label}</span>
					<span class="item-count">{formatDisplayDate(option.value)}</span>
				</button>
			{/each}
		{/if}
	</div>

	<div class="footer">
		<span><kbd>↑↓</kbd> navigate</span>
		<span><kbd>↵</kbd> insert</span>
		<span><kbd>esc</kbd> dismiss</span>
	</div>
</div>

<style>
	.popup {
		position: fixed;
		z-index: 1000;
		width: 260px;
		max-height: 360px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideDownFadeIn 120ms var(--ease-out);
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	.header .query {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.results {
		flex: 1;
		overflow-y: auto;
		max-height: 260px;
		padding: 0.25rem;
	}

	.empty {
		padding: 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.result-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		text-align: left;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.result-item.selected {
		background: var(--color-hover);
	}

	.item-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.item-count {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}


	.footer {
		display: flex;
		gap: 0.875rem;
		padding: 0.375rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.footer kbd {
		font-family: inherit;
		color: var(--color-text-muted);
	}
</style>
