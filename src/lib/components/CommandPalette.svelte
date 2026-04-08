<script lang="ts">
	import { search } from '$lib/search';
	import { goto } from '$app/navigation';
	import {
		addMemoryObject,
		addMeetingMemo,
		folders,
		memoryObjects,
		vaults,
		currentVaultId,
		setCurrentVault,
		addVault,
		transcribeMemoryAudio,
		todayIso
	} from '$lib/db';
	import { storeBlob } from '$lib/db/blob-store';
	import { getIconById } from '$lib/icons/vault-icons';
	import { syncState } from '$lib/sync/status';
	import { resourceColors } from '$lib/types/resources';
	import { exportVaultAsMarkdown, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import {
		triggerVoiceCapture,
		triggerMeetingCapture,
		triggerUploadRecording
	} from '$lib/stores/snackbar';
	import { Search, Cloud, CloudOff, Download } from 'lucide-svelte';

	interface Props {
		onClose: () => void;
		onShowTemplatePicker?: () => void;
	}

	let { onClose, onShowTemplatePicker }: Props = $props();

	let showCreateVaultModal = $state(false);
	let newVaultName = $state('');

	async function handleMarkdownExport(format: MarkdownExportFormat) {
		const vault = $vaults.find((v) => v.id === $currentVaultId);
		if (!vault) return;

		const vaultMemories = $memoryObjects.filter((m) => m.vaultId === vault.id);
		const vaultFolders = $folders.filter((f) => f.vaultId === vault.id);

		await exportVaultAsMarkdown(vaultMemories, vaultFolders, vault, { format });
		onClose();
	}

	interface Command {
		id: string;
		type: 'action' | 'note' | 'folder' | 'vault';
		title: string;
		description?: string;
		icon?: string;
		vaultIconId?: string; // For vault items, the icon ID from the vault icons library
		action: () => void;
	}

	const actions: Command[] = [
		{
			id: 'new-note',
			type: 'action',
			title: 'New Note',
			description: 'Create a new note',
			icon: 'plus',
			action: () => {
				const memory = addMemoryObject();
				goto(`/memory/${memory.id}`);
				onClose();
			}
		},
		{
			id: 'new-voice-memo',
			type: 'action',
			title: 'Record voice memo',
			description: 'Capture a quick audio note',
			icon: 'plus',
			action: () => {
				onClose();
				triggerVoiceCapture.set(true);
			}
		},
		{
			id: 'new-meeting',
			type: 'action',
			title: 'Record meeting',
			description: 'Long-form recording with structured summary',
			icon: 'plus',
			action: () => {
				onClose();
				triggerMeetingCapture.set(true);
			}
		},
		{
			id: 'upload-recording',
			type: 'action',
			title: 'Upload audio/video file',
			description: 'Import an existing recording for transcription',
			icon: 'plus',
			action: () => {
				onClose();
				triggerUploadRecording.set(true);
			}
		},
		{
			id: 'graph',
			type: 'action',
			title: 'Open Graph',
			description: 'View knowledge graph',
			icon: 'graph',
			action: () => {
				goto('/graph');
				onClose();
			}
		},
		{
			id: 'references',
			type: 'action',
			title: 'References',
			description: 'Browse tags, people, and dates',
			icon: 'references',
			action: () => {
				goto('/references');
				onClose();
			}
		},
		{
			id: 'read',
			type: 'action',
			title: 'Read Mode',
			description: 'View notes as a blog',
			icon: 'read',
			action: () => {
				goto('/read');
				onClose();
			}
		},
		{
			id: 'settings',
			type: 'action',
			title: 'Settings',
			description: 'Open settings',
			icon: 'settings',
			action: () => {
				goto('/settings');
				onClose();
			}
		},
		{
			id: 'home',
			type: 'action',
			title: 'Go Home',
			description: 'Return to home page',
			icon: 'home',
			action: () => {
				goto('/');
				onClose();
			}
		},
		{
			id: 'ask-kurumi',
			type: 'action',
			title: 'Ask Kurumi',
			description: 'Question your memories with AI',
			icon: 'sparkles',
			action: () => {
				goto('/');
				onClose();
			}
		},
		{
			id: 'daily-note',
			type: 'action',
			title: "Today's daily note",
			description: 'Open or create the daily note for today',
			icon: 'calendar',
			action: () => {
				goto(`/daily/${todayIso()}`);
				onClose();
			}
		},
		{
			id: 'actions',
			type: 'action',
			title: 'Action items',
			description: 'Open the tasks extracted from meetings',
			icon: 'check',
			action: () => {
				goto('/actions');
				onClose();
			}
		},
		{
			id: 'proposals',
			type: 'action',
			title: 'Reminder proposals',
			description: 'Review time-anchored nudges Kurumi extracted',
			icon: 'bell',
			action: () => {
				goto('/proposals');
				onClose();
			}
		},
		{
			id: 'review',
			type: 'action',
			title: 'Weekly review',
			description: 'Stats and summary for this week',
			icon: 'calendar',
			action: () => {
				goto('/review');
				onClose();
			}
		},
		{
			id: 'tags-manage',
			type: 'action',
			title: 'Manage tags',
			description: 'Merge duplicates and rename tags',
			icon: 'hash',
			action: () => {
				goto('/tags');
				onClose();
			}
		},
		{
			id: 'topics-manage',
			type: 'action',
			title: 'Manage topics & projects',
			description: 'Merge and rename extracted topics',
			icon: 'hash',
			action: () => {
				goto('/topics');
				onClose();
			}
		},
		{
			id: 'people',
			type: 'action',
			title: 'People',
			description: 'Manage and merge duplicate people',
			icon: 'users',
			action: () => {
				goto('/people');
				onClose();
			}
		},
		{
			id: 'export-vanilla',
			type: 'action',
			title: 'Export as Markdown',
			description: 'Export vault as plain markdown files',
			icon: 'download',
			action: () => handleMarkdownExport('vanilla')
		},
		{
			id: 'export-hugo',
			type: 'action',
			title: 'Export as Hugo-flavoured Markdown',
			description: 'Export vault with Hugo front matter',
			icon: 'download',
			action: () => handleMarkdownExport('hugo')
		},
		{
			id: 'export-zola',
			type: 'action',
			title: 'Export as Zola-flavoured Markdown',
			description: 'Export vault with Zola front matter',
			icon: 'download',
			action: () => handleMarkdownExport('zola')
		},
		{
			id: 'new-from-template',
			type: 'action',
			title: 'New from template',
			description: 'Create a note from a template',
			icon: 'template',
			action: () => {
				onClose();
				onShowTemplatePicker?.();
			}
		},
		{
			id: 'templates',
			type: 'action',
			title: 'Manage Templates',
			description: 'Create and edit note templates',
			icon: 'template',
			action: () => {
				goto('/templates');
				onClose();
			}
		}
	];

	let query = $state('');
	let results = $state<Command[]>([]);
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	// Strip HTML tags and clean up content for preview
	function stripHtml(html: string): string {
		return html
			.replace(/<[^>]*>/g, ' ')      // Remove HTML tags
			.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')  // Convert [[link]] or [[link|text]] to just the link/text
			.replace(/&nbsp;/g, ' ')       // Replace &nbsp;
			.replace(/&amp;/g, '&')        // Replace &amp;
			.replace(/&lt;/g, '<')         // Replace &lt;
			.replace(/&gt;/g, '>')         // Replace &gt;
			.replace(/#{1,6}\s*/g, '')     // Remove markdown headings
			.replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove bold markers
			.replace(/\*([^*]+)\*/g, '$1')      // Remove italic markers
			.replace(/`([^`]+)`/g, '$1')        // Remove inline code markers
			.replace(/\s+/g, ' ')          // Collapse whitespace
			.trim();
	}

	$effect(() => {
		const q = query.toLowerCase().trim();

		if (!q) {
			// Show recent folders and memories sorted by modified date (actions only with > prefix)
			const recentFolders: Command[] = $folders
				.sort((a, b) => b.modified - a.modified)
				.slice(0, 5)
				.map((f) => ({
					id: f.id,
					type: 'folder' as const,
					title: f.name,
					icon: 'folder',
					action: () => {
						onClose();
					}
				}));

			const recentMemories: Command[] = $memoryObjects
				.slice()
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, 10)
				.map((m) => ({
					id: m.id,
					type: 'note' as const,
					title: m.title || 'Untitled',
					icon: 'note',
					description: stripHtml(m.bodyMarkdown).slice(0, 60),
					action: () => {
						goto(`/memory/${m.id}`);
						onClose();
					}
				}));

			// Combine folders and memories, sort by modified time
			const recentItems = [...recentFolders, ...recentMemories]
				.sort((a, b) => {
					const aTime =
						a.type === 'folder'
							? ($folders.find((f) => f.id === a.id)?.modified ?? 0)
							: ($memoryObjects.find((m) => m.id === a.id)?.updatedAt ?? 0);
					const bTime =
						b.type === 'folder'
							? ($folders.find((f) => f.id === b.id)?.modified ?? 0)
							: ($memoryObjects.find((m) => m.id === b.id)?.updatedAt ?? 0);
					return bTime - aTime;
				})
				.slice(0, 10);

			results = recentItems;
		} else if (q.startsWith('>')) {
			// Action mode - only show actions
			const actionQuery = q.slice(1).trim();
			results = actions.filter(
				(a) =>
					a.title.toLowerCase().includes(actionQuery) ||
					a.description?.toLowerCase().includes(actionQuery)
			);
		} else {
			// Search notes, folders, and vaults (actions only with > prefix)
			const noteResults = search(q);

			// Search folders by name
			const matchingFolders = $folders.filter((f) =>
				f.name.toLowerCase().includes(q)
			);

			// Search vaults by name (exclude current vault)
			const matchingVaults = $vaults.filter(
				(v) => v.id !== $currentVaultId && v.name.toLowerCase().includes(q)
			);

			const vaultCommands: Command[] = matchingVaults.slice(0, 3).map((v) => ({
				id: v.id,
				type: 'vault',
				title: v.name,
				icon: 'vault',
				vaultIconId: v.icon,
				description: 'Switch to vault',
				action: () => {
					setCurrentVault(v.id);
					goto('/');
					onClose();
				}
			}));

			const folderCommands: Command[] = matchingFolders.slice(0, 5).map((f) => ({
				id: f.id,
				type: 'folder',
				title: f.name,
				icon: 'folder',
				action: () => {
					// Navigate to first note in folder, or just close
					onClose();
				}
			}));

			const noteCommands: Command[] = noteResults.slice(0, 10).map((r) => ({
				id: r.id,
				type: 'note',
				title: r.title,
				icon: 'note',
				description: stripHtml(r.content).slice(0, 60),
				action: () => {
					goto(`/memory/${r.id}`);
					onClose();
				}
			}));

			results = [...vaultCommands, ...folderCommands, ...noteCommands];
		}

		selectedIndex = 0;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			results[selectedIndex].action();
		}
	}

	function getIcon(icon?: string) {
		switch (icon) {
			case 'plus':
				return 'M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z';
			case 'graph':
				return 'M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z';
			case 'settings':
				return 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z';
			case 'home':
				return 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z';
			case 'references':
				return 'M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z';
			case 'folder':
				return 'M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z';
			case 'note':
				return 'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z';
			case 'read':
				return 'M10 12a2 2 0 100-4 2 2 0 000 4z M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z';
			case 'vault':
				return 'M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z';
			case 'download':
				return 'M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z';
			case 'sparkles':
				return 'M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z';
			case 'calendar':
				return 'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z';
			case 'check':
				return 'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z';
			case 'users':
				return 'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z';
			case 'bell':
				return 'M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z';
			case 'hash':
				return 'M9.243 3.03a1 1 0 01.727 1.213L9.53 6h2.94l.56-2.243a1 1 0 111.94.486L14.53 6H17a1 1 0 110 2h-2.97l-1 4H15a1 1 0 110 2h-2.47l-.56 2.242a1 1 0 11-1.94-.485L10.47 14H7.53l-.56 2.242a1 1 0 11-1.94-.485L5.47 14H3a1 1 0 110-2h2.97l1-4H5a1 1 0 110-2h2.47l.56-2.243a1 1 0 011.213-.727zM9.03 8l-1 4h2.94l1-4H9.03z';
			default:
				return 'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z';
		}
	}

	// Helper to get icon path, preferring vault icon if available
	function getItemIconPath(item: Command): string {
		if (item.vaultIconId) {
			const vaultIcon = getIconById(item.vaultIconId);
			if (vaultIcon) return vaultIcon.path;
		}
		return getIcon(item.icon);
	}

	$effect(() => {
		inputRef?.focus();
	});
</script>

<div
	class="animate-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 md:items-start md:p-4 md:pt-[15vh]"
	onclick={onClose}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="animate-modal flex h-full w-full max-w-none flex-col overflow-hidden rounded-none bg-[var(--color-bg)] shadow-2xl md:h-auto md:max-w-xl md:rounded-xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="search"
	>
		<!-- Input -->
		<div class="flex items-center gap-3 p-4">
			<div class="flex flex-1 items-center gap-3 rounded-xl bg-[var(--color-bg-secondary)] px-4 py-3 ring-1 ring-[var(--color-border)] focus-within:ring-[var(--color-accent)]">
				<Search class="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
				<div class="relative flex-1">
					<input
						bind:this={inputRef}
						bind:value={query}
						type="text"
						class="command-input w-full bg-transparent text-lg text-[var(--color-text)]"
						onkeydown={handleKeydown}
					/>
					{#if !query}
						<div class="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-lg text-[var(--color-text-muted)]">
							Search notes or type <code class="mx-1 rounded bg-[var(--color-border)] px-1.5 py-0.5 font-mono text-sm">&gt;</code> for actions
						</div>
					{/if}
				</div>
				<kbd
					class="hidden shrink-0 rounded bg-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] md:inline"
				>
					ESC
				</kbd>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="shrink-0 text-[var(--color-accent)] md:hidden"
			>
				Cancel
			</button>
		</div>

		<!-- Results -->
		<div class="flex-1 overflow-y-auto md:max-h-[60vh] md:flex-none">
			{#if results.length === 0}
				<div class="px-4 py-8 text-center text-[var(--color-text-muted)]">
					No results found
				</div>
			{:else}
				<ul class="py-2">
					{#each results as item, i}
						<li>
							<button
								type="button"
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); item.action(); }}
								class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
								class:bg-[var(--color-bg-secondary)]={i === selectedIndex}
							>
								<div
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
									class:bg-[var(--color-accent)]={item.type === 'action'}
									class:text-white={item.type === 'action'}
									style={item.type === 'folder' ? `background: ${resourceColors.folder.bgAlpha}; color: ${resourceColors.folder.color};` : item.type === 'vault' ? `background: ${resourceColors.vault.bgAlpha}; color: ${resourceColors.vault.color};` : item.type === 'note' ? `background: ${resourceColors.note.bgAlpha}; color: ${resourceColors.note.color};` : ''}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path fill-rule="evenodd" d={getItemIconPath(item)} clip-rule="evenodd" />
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<div class="font-medium text-[var(--color-text)]">
										{item.title}
									</div>
									{#if item.description}
										<div class="truncate text-sm text-[var(--color-text-muted)]">
											{item.description}
										</div>
									{/if}
								</div>
								{#if item.type === 'action'}
									<span
										class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
										style="background: {resourceColors.action.bgAlpha}; color: {resourceColors.action.color};"
									>
										Action
									</span>
								{:else if item.type === 'folder'}
									<span
										class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
										style="background: {resourceColors.folder.bgAlpha}; color: {resourceColors.folder.color};"
									>
										Folder
									</span>
								{:else if item.type === 'note'}
									<span
										class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
										style="background: {resourceColors.note.bgAlpha}; color: {resourceColors.note.color};"
									>
										Note
									</span>
								{:else if item.type === 'vault'}
									<span
										class="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
										style="background: {resourceColors.vault.bgAlpha}; color: {resourceColors.vault.color};"
									>
										Vault
									</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]"
		>
			<div class="flex items-center gap-4">
				<!-- Sync status -->
				<span class="flex items-center gap-1.5">
					{#if $syncState.lastSyncedAt}
						<Cloud class="h-3.5 w-3.5" style="color: {resourceColors.note.color};" />
						<span>Synced {new Date($syncState.lastSyncedAt).toLocaleDateString()}</span>
					{:else}
						<CloudOff class="h-3.5 w-3.5" />
						<span>Not synced</span>
					{/if}
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↑↓</kbd>
					navigate
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↵</kbd>
					select
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 font-mono">&gt;</kbd>
					actions
				</span>
			</div>
			<span>{results.length} {results.length === 1 ? 'result' : 'results'}</span>
		</div>
	</div>
</div>

<style>
	.command-input {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}

	.command-input:focus,
	.command-input:focus-visible {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}
</style>
