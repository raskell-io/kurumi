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
		Database
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

<div class="slash-menu" bind:this={menuRef} {style}>
	{#if flatList.length === 0}
		<div class="empty">No matching commands</div>
	{:else}
		{#each groups as group}
			<div class="group-label">{group.category}</div>
			{#each group.commands as cmd, i}
				{@const globalIndex = flatList.indexOf(cmd)}
				<button
					class="cmd"
					class:selected={globalIndex === selectedIndex}
					data-index={globalIndex}
					onclick={() => handleClick(cmd)}
					onmouseenter={() => (selectedIndex = globalIndex)}
				>
					<span class="cmd-icon">
						{#if iconMap[cmd.icon]}
							{@const Icon = iconMap[cmd.icon]}
							<Icon class="h-4 w-4" />
						{/if}
					</span>
					<span class="cmd-body">
						<span class="cmd-label">{cmd.label}</span>
						<span class="cmd-desc">{cmd.description}</span>
					</span>
				</button>
			{/each}
		{/each}
	{/if}
</div>

<style>
	.slash-menu {
		position: fixed;
		z-index: 100;
		width: 260px;
		max-height: 340px;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.625rem;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
		padding: 0.375rem;
		animation: fade-in 0.12s ease-out;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.empty {
		padding: 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.group-label {
		padding: 0.375rem 0.625rem 0.25rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.cmd {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.4375rem 0.625rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 0.08s;
	}

	.cmd:hover,
	.cmd.selected {
		background: var(--color-bg-secondary);
	}

	.cmd-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
		border-radius: 0.375rem;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.cmd.selected .cmd-icon {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.cmd-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.cmd-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		line-height: 1.2;
	}

	.cmd-desc {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		line-height: 1.2;
		margin-top: 0.125rem;
	}
</style>
