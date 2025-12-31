<script lang="ts">
	import { Download, FileText, Table, Calendar as CalendarIcon, Users } from 'lucide-svelte';
	import type { PersonWithMetadata, DateWithEvents } from '$lib/db/store';
	import {
		downloadPeopleVCard,
		downloadPeopleCSV,
		downloadEventsICal,
		downloadEventsCSV,
		downloadTagsCSV,
		downloadLinksCSV
	} from '$lib/utils/export';

	type ExportType = 'people' | 'dates' | 'tags' | 'links';

	interface Props {
		type: ExportType;
		people?: PersonWithMetadata[];
		dates?: DateWithEvents[];
		tags?: { tag: string; count: number }[];
		links?: { url: string; domain: string; count: number }[];
	}

	let { type, people = [], dates = [], tags = [], links = [] }: Props = $props();

	let isOpen = $state(false);
	let menuRef: HTMLDivElement;

	function toggleMenu() {
		isOpen = !isOpen;
	}

	function closeMenu() {
		isOpen = false;
	}

	function handleExport(format: string) {
		switch (type) {
			case 'people':
				if (format === 'vcard') downloadPeopleVCard(people);
				if (format === 'csv') downloadPeopleCSV(people);
				break;
			case 'dates':
				if (format === 'ical') downloadEventsICal(dates);
				if (format === 'csv') downloadEventsCSV(dates);
				break;
			case 'tags':
				if (format === 'csv') downloadTagsCSV(tags);
				break;
			case 'links':
				if (format === 'csv') downloadLinksCSV(links);
				break;
		}
		closeMenu();
	}

	// Close on outside click
	function handleClickOutside(event: MouseEvent) {
		if (menuRef && !menuRef.contains(event.target as Node)) {
			closeMenu();
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	// Get item count
	let itemCount = $derived(
		type === 'people'
			? people.length
			: type === 'dates'
				? dates.length
				: type === 'tags'
					? tags.length
					: links.length
	);
</script>

<div class="export-menu" bind:this={menuRef}>
	<button class="export-btn" onclick={toggleMenu} disabled={itemCount === 0} title="Export">
		<Download class="h-4 w-4" />
	</button>

	{#if isOpen}
		<div class="dropdown">
			<div class="dropdown-header">
				<span>Export {itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
			</div>

			{#if type === 'people'}
				<button class="dropdown-item" onclick={() => handleExport('vcard')}>
					<Users class="h-4 w-4" />
					<span>vCard (.vcf)</span>
					<span class="format-desc">Contact format</span>
				</button>
				<button class="dropdown-item" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4" />
					<span>CSV</span>
					<span class="format-desc">Spreadsheet</span>
				</button>
			{:else if type === 'dates'}
				<button class="dropdown-item" onclick={() => handleExport('ical')}>
					<CalendarIcon class="h-4 w-4" />
					<span>iCal (.ics)</span>
					<span class="format-desc">Calendar format</span>
				</button>
				<button class="dropdown-item" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4" />
					<span>CSV</span>
					<span class="format-desc">Spreadsheet</span>
				</button>
			{:else}
				<button class="dropdown-item" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4" />
					<span>CSV</span>
					<span class="format-desc">Spreadsheet</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.export-menu {
		position: relative;
	}

	.export-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
		transition: all 0.1s;
	}

	.export-btn:hover:not(:disabled) {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.25rem;
		min-width: 180px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.1),
			0 2px 4px -1px rgba(0, 0, 0, 0.06);
		z-index: 50;
		overflow: hidden;
	}

	.dropdown-header {
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.dropdown-item:hover {
		background: var(--color-bg-secondary);
	}

	.dropdown-item span:first-of-type {
		flex: 1;
	}

	.format-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
