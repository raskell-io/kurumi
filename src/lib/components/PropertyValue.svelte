<script lang="ts">
	/**
	 * One database property value, shown and edited in place: a table cell,
	 * a board card or a row of the Properties panel on a note.
	 *
	 * Select and multi-select pick from the property's options; typing a new
	 * one adds it (onAddOption). Everything else edits inline.
	 */
	import type { PropertyDefinition } from '$lib/db/types';
	import { asList, formatDate, isEmptyValue, optionHue, parseInput } from '$lib/database';
	import Popover from './Popover.svelte';
	import { Check, ExternalLink, X } from 'lucide-svelte';

	interface Props {
		prop: PropertyDefinition;
		value: unknown;
		/** Options to offer for select/multi-select (the schema's plus ones in use). */
		options?: string[];
		onChange: (value: unknown) => void;
		onAddOption?: (option: string) => void;
		readonly?: boolean;
		placeholder?: string;
	}

	let { prop, value, options = prop.options ?? [], onChange, onAddOption, readonly = false, placeholder = 'Empty' }: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let trigger: HTMLButtonElement | undefined = $state();
	let picking = $state(false);
	let query = $state('');

	const selected = $derived(asList(value));
	const filtered = $derived(options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase())));
	const canCreate = $derived(
		!!query.trim() && !options.some((o) => o.toLowerCase() === query.trim().toLowerCase())
	);

	function startEdit() {
		if (readonly) return;
		if (prop.type === 'select' || prop.type === 'multiSelect') {
			query = '';
			picking = true;
			return;
		}
		draft = isEmptyValue(value) ? '' : String(value);
		editing = true;
	}

	function commit() {
		if (!editing) return;
		editing = false;
		const next = parseInput(prop.type, draft);
		if (String(next ?? '') !== String(value ?? '')) onChange(next);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			editing = false;
		}
	}

	function choose(option: string) {
		if (prop.type === 'select') {
			onChange(selected[0] === option ? null : option);
			picking = false;
			return;
		}
		onChange(selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option]);
	}

	function create() {
		const option = query.trim();
		if (!option) return;
		onAddOption?.(option);
		choose(option);
		query = '';
	}

	function pickKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (canCreate) create();
			else if (filtered[0]) choose(filtered[0]);
		}
	}

	// After the frame: a popover moves its content to <body>, which drops focus.
	const focusInput = (node: HTMLInputElement) => {
		requestAnimationFrame(() => {
			node.focus();
			node.select?.();
		});
	};

	const isUrl = (text: string) => /^https?:\/\//i.test(text);
</script>

{#if prop.type === 'checkbox'}
	<label class="pv-check">
		<input
			type="checkbox"
			checked={!!value}
			disabled={readonly}
			onchange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
			aria-label={prop.label}
		/>
	</label>
{:else if prop.type === 'date' && !readonly}
	<input
		type="date"
		class="pv-date"
		class:is-empty={isEmptyValue(value)}
		value={typeof value === 'string' ? value : ''}
		onchange={(e) => onChange((e.currentTarget as HTMLInputElement).value || null)}
		aria-label={prop.label}
	/>
{:else if editing}
	<input
		class="pv-input"
		type={prop.type === 'number' ? 'number' : prop.type === 'url' ? 'url' : 'text'}
		step="any"
		bind:value={draft}
		onkeydown={onKey}
		onblur={commit}
		aria-label={prop.label}
		use:focusInput
	/>
{:else}
	<span class="pv">
		<button
			type="button"
			class="pv-btn"
			class:is-empty={isEmptyValue(value)}
			bind:this={trigger}
			onclick={startEdit}
			disabled={readonly}
			aria-label="{prop.label}: {isEmptyValue(value) ? 'empty' : asList(value).join(', ')}"
		>
			{#if isEmptyValue(value)}
				<span class="pv-empty">{placeholder}</span>
			{:else if prop.type === 'select' || prop.type === 'multiSelect'}
				<span class="pv-chips">
					{#each selected as option (option)}
						<span class="k-chip hue-{optionHue(option)}">{option}</span>
					{/each}
				</span>
			{:else if prop.type === 'date'}
				{formatDate(String(value))}
			{:else if prop.type === 'number'}
				<span class="tabular-nums">{Number(value).toLocaleString()}</span>
			{:else if prop.type === 'person'}
				@{String(value)}
			{:else}
				{String(value)}
			{/if}
		</button>
		{#if prop.type === 'url' && typeof value === 'string' && isUrl(value)}
			<a href={value} target="_blank" rel="noopener noreferrer" class="pv-open" title="Open link" aria-label="Open link">
				<ExternalLink class="h-3.5 w-3.5" />
			</a>
		{/if}
	</span>
{/if}

{#if picking && trigger}
	<Popover anchor={trigger} onClose={() => (picking = false)} label="{prop.label} options">
		<input
			class="k-input !h-8 !text-[0.8125rem]"
			placeholder={onAddOption ? 'Find or add an option' : 'Find an option'}
			bind:value={query}
			onkeydown={pickKey}
			use:focusInput
		/>
		<div class="mt-1 max-h-60 overflow-y-auto">
			{#each filtered as option (option)}
				<button type="button" class="k-menu-item justify-between" onclick={() => choose(option)}>
					<span class="k-chip hue-{optionHue(option)}">{option}</span>
					{#if selected.includes(option)}<Check class="h-3.5 w-3.5 text-[var(--color-accent)]" />{/if}
				</button>
			{/each}
			{#if canCreate && onAddOption}
				<button type="button" class="k-menu-item" onclick={create}>
					Add <span class="k-chip hue-{optionHue(query.trim())}">{query.trim()}</span>
				</button>
			{/if}
			{#if !filtered.length && !canCreate}
				<p class="k-menu-label">No options yet: type one.</p>
			{/if}
		</div>
		{#if selected.length > 0}
			<div class="k-menu-sep"></div>
			<button type="button" class="k-menu-item" onclick={() => { onChange(null); picking = false; }}>
				<X class="h-3.5 w-3.5" /> Clear
			</button>
		{/if}
	</Popover>
{/if}

<style>
	.pv {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.25rem;
	}

	.pv-btn {
		display: block;
		min-width: 0;
		min-height: 1.75rem;
		flex: 1;
		padding: 0.25rem 0.375rem;
		border-radius: var(--radius-sm);
		text-align: left;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pv-btn:not(:disabled):hover {
		background: var(--color-hover);
	}

	.pv-btn:disabled {
		cursor: default;
	}

	.pv-empty {
		color: var(--color-text-faint);
	}

	.pv-chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.pv-input,
	.pv-date {
		width: 100%;
		min-height: 1.75rem;
		padding: 0.25rem 0.375rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
	}

	.pv-input {
		border-color: var(--color-accent);
		background: var(--color-bg);
		outline: none;
	}

	.pv-date:hover,
	.pv-date:focus {
		background: var(--color-hover);
		outline: none;
	}

	/* An empty date shows nothing until it's pointed at (not dd.mm.yyyy everywhere) */
	.pv-date.is-empty:not(:focus):not(:hover) {
		color: transparent;
	}

	.pv-date.is-empty:not(:focus):not(:hover)::-webkit-calendar-picker-indicator {
		opacity: 0;
	}

	.pv-check {
		display: flex;
		min-height: 1.75rem;
		align-items: center;
		padding: 0 0.375rem;
	}

	.pv-check input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.pv-open {
		display: inline-flex;
		flex-shrink: 0;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
	}

	.pv-open:hover {
		background: var(--color-hover);
		color: var(--color-accent);
	}
</style>
