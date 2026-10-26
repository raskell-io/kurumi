<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import { autofocus } from '$lib/actions/autofocus';
	import { emojiGroups, searchEmoji, randomEmoji, isEmoji } from '$lib/icons/emoji';
	import { imageToIconDataUrl } from '$lib/utils/image';
	import { Search, Shuffle, Upload, Trash2 } from 'lucide-svelte';

	// Notion-style page icon picker: curated emoji with search, paste any
	// emoji, random, or upload an image. Rendered at `anchor` (viewport
	// coordinates of the element that opened it) and portaled to <body>.
	interface Props {
		anchor: { left: number; top: number; bottom: number };
		hasIcon: boolean;
		onSelect: (icon: string) => void;
		onRemove: () => void;
		onClose: () => void;
	}

	let { anchor, hasIcon, onSelect, onRemove, onClose }: Props = $props();

	let query = $state('');
	let uploadError = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	let results = $derived(query.trim() ? searchEmoji(query) : []);
	let pasted = $derived(isEmoji(query) ? query.trim() : null);

	function pick(icon: string) {
		onSelect(icon);
		onClose();
	}

	async function handleUpload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			pick(await imageToIconDataUrl(file));
		} catch {
			uploadError = "Couldn't read that image.";
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const first = pasted ?? results[0]?.emoji;
			if (first) pick(first);
		}
	}

	// Open below the anchor, or above it when there's no room.
	function place(node: HTMLElement) {
		const margin = 8;
		const rect = node.getBoundingClientRect();
		let top = anchor.bottom + 6;
		if (top + rect.height > window.innerHeight - margin) {
			top = Math.max(margin, anchor.top - rect.height - 6);
		}
		const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - rect.width - margin);
		node.style.top = `${top}px`;
		node.style.left = `${left}px`;
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div use:portal class="fixed inset-0 z-[150]" onclick={onClose}></div>
<div
	use:portal
	use:place
	class="k-menu fixed z-[151] flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col !p-0"
	role="dialog"
	aria-label="Choose an icon"
	tabindex="-1"
	onkeydown={handleKeydown}
>
	<div class="flex items-center gap-1 border-b border-[var(--color-border)] p-1.5">
		<div class="flex min-w-0 flex-1 items-center gap-2 px-1.5">
			<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
			<input
				bind:value={query}
				use:autofocus
				type="text"
				placeholder="Search or paste an emoji…"
				aria-label="Search emoji"
				class="picker-search min-w-0 flex-1 bg-transparent py-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
			/>
		</div>
		<button class="k-icon-btn" title="Random" aria-label="Random emoji" onclick={() => pick(randomEmoji())}>
			<Shuffle class="h-3.5 w-3.5" />
		</button>
		<button class="k-icon-btn" title="Upload image" aria-label="Upload image" onclick={() => fileInput?.click()}>
			<Upload class="h-3.5 w-3.5" />
		</button>
		{#if hasIcon}
			<button
				class="k-icon-btn"
				title="Remove icon"
				aria-label="Remove icon"
				onclick={() => {
					onRemove();
					onClose();
				}}
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>
		{/if}
		<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={handleUpload} />
	</div>

	{#if uploadError}
		<p class="px-3 pt-2 text-xs text-[var(--color-danger)]">{uploadError}</p>
	{/if}

	<div class="max-h-72 overflow-y-auto p-1.5">
		{#if pasted}
			<button class="k-menu-item" onclick={() => pick(pasted!)}>
				<span class="text-lg leading-none">{pasted}</span> Use this emoji
			</button>
		{:else if query.trim()}
			{#if results.length === 0}
				<p class="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
					No match. Paste any emoji, or upload an image.
				</p>
			{:else}
				{@render grid(results)}
			{/if}
		{:else}
			{#each emojiGroups as group (group.name)}
				<div class="k-menu-label">{group.name}</div>
				{@render grid(group.items)}
			{/each}
		{/if}
	</div>
</div>

{#snippet grid(items: { emoji: string; keywords: string }[])}
	<div class="grid grid-cols-9 gap-0.5">
		{#each items as item (item.emoji)}
			<button
				class="emoji-cell"
				title={item.keywords.split(' ')[0]}
				aria-label={item.keywords.split(' ')[0]}
				onclick={() => pick(item.emoji)}
			>
				{item.emoji}
			</button>
		{/each}
	</div>
{/snippet}

<style>
	/* Override the global input border/focus ring, as the command palette does. */
	.picker-search,
	.picker-search:focus,
	.picker-search:focus-visible {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}

	.emoji-cell {
		display: flex;
		aspect-ratio: 1;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm, 6px);
		font-size: 1.25rem;
		line-height: 1;
	}
	.emoji-cell:hover,
	.emoji-cell:focus-visible {
		background: var(--color-hover);
		outline: none;
	}
</style>
