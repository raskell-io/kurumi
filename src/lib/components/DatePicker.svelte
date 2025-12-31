<script lang="ts">
	import { Calendar } from 'lucide-svelte';

	interface Props {
		position: { x: number; y: number };
		initialQuery: string;
		onSelect: (date: string) => void;
		onClose: () => void;
	}

	let { position, initialQuery, onSelect, onClose }: Props = $props();

	let inputRef: HTMLInputElement;

	// Parse initial query if it looks like a partial date
	function getInitialDate(): string {
		const today = new Date();
		return today.toISOString().split('T')[0];
	}

	let selectedDate = $state(getInitialDate());

	// Quick date options
	const quickDates = $derived.by(() => {
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const nextWeek = new Date(today);
		nextWeek.setDate(nextWeek.getDate() + 7);
		const nextMonth = new Date(today);
		nextMonth.setMonth(nextMonth.getMonth() + 1);

		return [
			{ label: 'Today', date: today.toISOString().split('T')[0] },
			{ label: 'Tomorrow', date: tomorrow.toISOString().split('T')[0] },
			{ label: 'Next week', date: nextWeek.toISOString().split('T')[0] },
			{ label: 'Next month', date: nextMonth.toISOString().split('T')[0] }
		];
	});

	$effect(() => {
		inputRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selectedDate) {
				onSelect(selectedDate);
			}
		}
	}

	function formatDisplayDate(dateStr: string): string {
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="date-picker"
	style="left: {position.x}px; top: {position.y}px;"
	onkeydown={handleKeydown}
>
	<div class="header">
		<Calendar class="h-4 w-4" />
		<span>Select date</span>
		<kbd>ESC</kbd>
	</div>

	<div class="date-input-wrapper">
		<input
			bind:this={inputRef}
			bind:value={selectedDate}
			type="date"
			class="date-input"
		/>
		{#if selectedDate}
			<div class="date-preview">{formatDisplayDate(selectedDate)}</div>
		{/if}
	</div>

	<div class="quick-dates">
		{#each quickDates as { label, date }}
			<button
				class="quick-date"
				class:selected={selectedDate === date}
				onclick={() => onSelect(date)}
			>
				{label}
			</button>
		{/each}
	</div>

	<div class="footer">
		<span>Format: YYYY-MM-DD</span>
		<button class="insert-btn" onclick={() => onSelect(selectedDate)}>
			Insert
			<kbd>↵</kbd>
		</button>
	</div>
</div>

<style>
	.date-picker {
		position: fixed;
		z-index: 1000;
		width: 280px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		overflow: hidden;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.header kbd {
		margin-left: auto;
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		background: var(--color-bg-secondary);
		border-radius: 0.25rem;
	}

	.date-input-wrapper {
		padding: 0.75rem;
	}

	.date-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		color: var(--color-text);
		font-size: 0.875rem;
		outline: none;
	}

	.date-input:focus {
		border-color: var(--color-accent);
	}

	.date-preview {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.quick-dates {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		padding: 0 0.75rem 0.75rem;
	}

	.quick-date {
		padding: 0.5rem;
		background: var(--color-bg-secondary);
		border: 1px solid transparent;
		border-radius: 0.375rem;
		color: var(--color-text);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.quick-date:hover {
		border-color: var(--color-accent);
	}

	.quick-date.selected {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.insert-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		color: white;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.insert-btn:hover {
		filter: brightness(1.1);
	}

	.insert-btn kbd {
		font-size: 0.625rem;
		opacity: 0.8;
	}
</style>
