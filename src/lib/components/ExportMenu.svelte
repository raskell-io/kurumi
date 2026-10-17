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

	function handleEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') closeMenu();
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
			return () => {
				document.removeEventListener('click', handleClickOutside);
				document.removeEventListener('keydown', handleEscape);
			};
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

<div class="relative" bind:this={menuRef}>
	<button
		class="k-icon-btn"
		onclick={toggleMenu}
		disabled={itemCount === 0}
		title="Export"
		aria-label="Export"
		aria-haspopup="menu"
		aria-expanded={isOpen}
	>
		<Download class="h-4 w-4" />
	</button>

	{#if isOpen}
		<div class="k-menu absolute right-0 top-full z-50 mt-1" role="menu">
			<div class="k-menu-label">Export {itemCount} {itemCount === 1 ? 'item' : 'items'}</div>

			{#if type === 'people'}
				<button class="k-menu-item" role="menuitem" onclick={() => handleExport('vcard')}>
					<Users class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="flex-1">vCard (.vcf)</span>
					<span class="text-xs text-[var(--color-text-faint)]">Contacts</span>
				</button>
				<button class="k-menu-item" role="menuitem" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="flex-1">CSV</span>
					<span class="text-xs text-[var(--color-text-faint)]">Spreadsheet</span>
				</button>
			{:else if type === 'dates'}
				<button class="k-menu-item" role="menuitem" onclick={() => handleExport('ical')}>
					<CalendarIcon class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="flex-1">iCal (.ics)</span>
					<span class="text-xs text-[var(--color-text-faint)]">Calendar</span>
				</button>
				<button class="k-menu-item" role="menuitem" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="flex-1">CSV</span>
					<span class="text-xs text-[var(--color-text-faint)]">Spreadsheet</span>
				</button>
			{:else}
				<button class="k-menu-item" role="menuitem" onclick={() => handleExport('csv')}>
					<Table class="h-4 w-4 text-[var(--color-text-faint)]" />
					<span class="flex-1">CSV</span>
					<span class="text-xs text-[var(--color-text-faint)]">Spreadsheet</span>
				</button>
			{/if}
		</div>
	{/if}
</div>
