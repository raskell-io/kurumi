<script lang="ts">
	import {
		builtInSlashCommands,
		executeSlashCommand,
		closeSlashMenu,
		type SlashCommand
	} from '$lib/editor/slashCommands';
	import {
		Heading,
		List,
		ListOrdered,
		CheckSquare,
		Quote,
		Minus,
		Code,
		Calendar,
		AtSign,
		Hash,
		Link,
		Table,
		Info,
		AlertTriangle,
		Lightbulb,
		Database,
		Highlighter,
		Camera,
		Image,
		ChevronRight,
		FileText,
		Sigma
	} from 'lucide-svelte';

	interface Props {
		query: string;
		position: { x: number; y: number };
	}

	let { query, position }: Props = $props();

	const iconMap: Record<string, typeof Heading> = {
		heading: Heading,
		list: List,
		'list-ordered': ListOrdered,
		'check-square': CheckSquare,
		quote: Quote,
		minus: Minus,
		code: Code,
		calendar: Calendar,
		'at-sign': AtSign,
		hash: Hash,
		link: Link,
		table: Table,
		info: Info,
		'alert-triangle': AlertTriangle,
		lightbulb: Lightbulb,
		database: Database
	};

	// Some commands share a generic icon name in the registry; give them a
	// more telling one here.
	const idIconMap: Record<string, typeof Heading> = {
		highlight: Highlighter,
		camera: Camera,
		image: Image,
		toggle: ChevronRight,
		'memory-embed': FileText,
		'math-block': Sigma,
		'math-inline': Sigma
	};

	// Markdown shortcuts that produce the same block, shown as quiet hints
	const shortcutHints: Record<string, string> = {
		heading1: '#',
		heading2: '##',
		heading3: '###',
		'bullet-list': '-',
		'numbered-list': '1.',
		checkbox: '[]',
		quote: '>',
		divider: '---',
		'code-block': '```',
		mention: '@',
		tag: '#tag',
		wikilink: '[[',
		date: '//'
	};

	let selectedIndex = $state(0);
	let menuRef: HTMLDivElement | undefined = $state();

	let filtered = $derived.by(() => {
		if (!query) return builtInSlashCommands;
		const q = query.toLowerCase().trim();
		return builtInSlashCommands.filter(
			(cmd) =>
				cmd.label.toLowerCase().includes(q) ||
				cmd.description.toLowerCase().includes(q) ||
				cmd.category.toLowerCase().includes(q) ||
				cmd.id.toLowerCase().includes(q)
		);
	});

	// Reset selection when filter changes
	$effect(() => {
		void filtered;
		selectedIndex = 0;
	});

	// Group by category for display
	type Group = { category: string; commands: SlashCommand[] };
	let groups = $derived.by<Group[]>(() => {
		const map = new Map<string, SlashCommand[]>();
		for (const cmd of filtered) {
			if (!map.has(cmd.category)) map.set(cmd.category, []);
			map.get(cmd.category)!.push(cmd);
		}
		return Array.from(map.entries()).map(([category, commands]) => ({
			category,
			commands
		}));
	});

	// Flat list for keyboard navigation indexing
	let flatList = $derived(filtered);

	function handleKeydown(e: KeyboardEvent) {
		if (flatList.length === 0) return;
		switch (e.key) {
			case 'ArrowDown':
			case 'Tab':
				e.preventDefault();
				e.stopPropagation();
				selectedIndex = (selectedIndex + 1) % flatList.length;
				scrollToSelected();
				break;
			case 'ArrowUp':
				e.preventDefault();
				e.stopPropagation();
				selectedIndex = (selectedIndex - 1 + flatList.length) % flatList.length;
				scrollToSelected();
				break;
			case 'Enter':
				e.preventDefault();
				e.stopPropagation();
				if (flatList[selectedIndex]) {
					executeSlashCommand(flatList[selectedIndex]);
				}
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				closeSlashMenu();
				break;
		}
	}

	function scrollToSelected() {
		const el = menuRef?.querySelector(`[data-index="${selectedIndex}"]`);
		if (el) el.scrollIntoView({ block: 'nearest' });
	}

	function handleClick(cmd: SlashCommand) {
		executeSlashCommand(cmd);
	}

	// Use a global keydown listener because the editor has focus, not our menu
	$effect(() => {
		window.addEventListener('keydown', handleKeydown, true);
		return () => window.removeEventListener('keydown', handleKeydown, true);
	});

	// Position: anchor to the slash position, bounded to viewport
	let style = $derived.by(() => {
		const x = Math.min(position.x, window.innerWidth - 280);
		const y = position.y;
		// If too close to bottom, flip above
		const maxY = window.innerHeight - 360;
		if (y > maxY) {
			return `left: ${x}px; bottom: ${window.innerHeight - position.y + 24}px;`;
		}
		return `left: ${x}px; top: ${y}px;`;
	});
</script>

<div class="slash-menu k-menu" bind:this={menuRef} {style} role="listbox" aria-label="Insert block">
	{#if flatList.length === 0}
		<div class="empty">No matching commands</div>
	{:else}
		{#each groups as group}
			<div class="k-menu-label">{group.category}</div>
			{#each group.commands as cmd}
				{@const globalIndex = flatList.indexOf(cmd)}
				{@const Icon = idIconMap[cmd.id] ?? iconMap[cmd.icon]}
				<button
					type="button"
					class="k-menu-item cmd"
					class:selected={globalIndex === selectedIndex}
					role="option"
					aria-selected={globalIndex === selectedIndex}
					data-index={globalIndex}
					onclick={() => handleClick(cmd)}
					onmouseenter={() => (selectedIndex = globalIndex)}
				>
					<span class="cmd-icon">
						{#if Icon}
							<Icon class="h-4 w-4" />
						{/if}
					</span>
					<span class="cmd-body">
						<span class="cmd-label">{cmd.label}</span>
						<span class="cmd-desc">{cmd.description}</span>
					</span>
					{#if shortcutHints[cmd.id]}
						<span class="cmd-hint">{shortcutHints[cmd.id]}</span>
					{/if}
				</button>
			{/each}
		{/each}
	{/if}
</div>

<style>
	.slash-menu {
		position: fixed;
		z-index: 100;
		width: 272px;
		max-height: 340px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.empty {
		padding: 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	/* Keyboard selection mirrors hover */
	.cmd.selected {
		background: var(--color-hover);
	}

	.cmd-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.cmd.selected .cmd-icon {
		color: var(--color-text-muted);
	}

	.cmd-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.cmd-label {
		font-size: 0.8125rem;
		color: var(--color-text);
		line-height: 1.25;
	}

	.cmd-desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		line-height: 1.25;
	}

	.cmd-hint {
		flex-shrink: 0;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}
</style>
