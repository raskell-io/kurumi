<script lang="ts">
	import {
		SHORTCUTS,
		shortcutOverrides,
		bindingsFor,
		setBinding,
		resetBinding,
		resetAllBindings,
		comboFromEvent,
		formatCombo,
		conflictsFor,
		type ShortcutId
	} from '$lib/shortcuts';
	import { RotateCcw } from 'lucide-svelte';

	// Rebind app shortcuts: click "Change", press the new combo. Escape
	// cancels; Backspace clears the binding.
	let recording = $state<ShortcutId | null>(null);
	let warning = $state<{ id: ShortcutId; text: string } | null>(null);

	const groups = ['General', 'Navigate', 'Editor'] as const;

	function handleRecordKey(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') {
			recording = null;
			return;
		}
		if (e.key === 'Backspace' || e.key === 'Delete') {
			setBinding(recording, []);
			recording = null;
			return;
		}
		const combo = comboFromEvent(e);
		if (!combo) return; // a lone modifier; keep listening
		if (!combo.includes('mod') && !combo.includes('ctrl') && !combo.includes('alt')) {
			warning = { id: recording, text: 'Use a combination with ⌘/Ctrl or ⌥/Alt so it doesn’t fire while you type.' };
			return;
		}
		const clashes = conflictsFor(combo, recording);
		warning = clashes.length
			? { id: recording, text: `Also used by “${clashes.map((c) => c.label).join('”, “')}”. Change that one too.` }
			: null;
		setBinding(recording, [combo]);
		recording = null;
	}
</script>

<svelte:window onkeydowncapture={handleRecordKey} />

{#each groups as group (group)}
	<h3 class="k-menu-label !px-0 pt-3">{group}</h3>
	{#each SHORTCUTS.filter((s) => s.group === group) as shortcut (shortcut.id)}
		{@const combos = bindingsFor(shortcut.id, $shortcutOverrides)}
		{@const custom = shortcut.id in $shortcutOverrides}
		<div class="set-row !py-2">
			<div class="set-row-text">
				<div class="set-row-label">{shortcut.label}</div>
				{#if warning?.id === shortcut.id}
					<p class="set-row-help !text-[var(--color-danger)]">{warning.text}</p>
				{/if}
			</div>
			<div class="flex items-center gap-1.5">
				{#if recording === shortcut.id}
					<span class="k-kbd animate-pulse">Press keys…</span>
				{:else if combos.length}
					{#each combos as combo (combo)}<span class="k-kbd">{formatCombo(combo)}</span>{/each}
				{:else}
					<span class="text-xs text-[var(--color-text-faint)]">None</span>
				{/if}
				<button
					class="k-btn k-btn-ghost k-btn-sm"
					onclick={() => {
						warning = null;
						recording = recording === shortcut.id ? null : shortcut.id;
					}}
				>
					{recording === shortcut.id ? 'Cancel' : 'Change'}
				</button>
				<button
					class="k-icon-btn"
					class:invisible={!custom}
					onclick={() => resetBinding(shortcut.id)}
					title="Reset to default"
					aria-label="Reset {shortcut.label} to default"
				>
					<RotateCcw class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	{/each}
{/each}

{#if Object.keys($shortcutOverrides).length}
	<div class="pt-3">
		<button class="k-btn k-btn-sm" onclick={resetAllBindings}>Reset all to defaults</button>
	</div>
{/if}
