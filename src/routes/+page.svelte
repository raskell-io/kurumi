<script lang="ts">
	import { notes, addNote } from '$lib/db';
	import { goto } from '$app/navigation';
	import { Plus } from 'lucide-svelte';

	function handleNewNote() {
		const note = addNote();
		goto(`/note/${note.id}`);
	}

	const tips = [
		{ icon: '[[', text: 'Use [[Note Title]] to link notes together' },
		{ icon: '#', text: 'Add #tags to organize your thoughts' },
		{ icon: '/', text: 'Press Cmd+K to search and navigate quickly' }
	];
</script>

<div class="flex h-full flex-col items-center justify-center p-6 md:p-8">
	<div class="text-center">
		<img
			src="/icon-512.avif"
			alt="Kurumi"
			class="mx-auto mb-4 h-20 w-20 rounded-2xl shadow-lg md:mb-6 md:h-24 md:w-24"
		/>
		<h1 class="mb-2 text-2xl font-bold text-[var(--color-text)] md:text-3xl">
			Welcome to Kurumi
		</h1>
		<p class="mb-6 text-[var(--color-text-muted)] md:mb-8">Your local-first second brain</p>

		{#if $notes.length === 0}
			<button
				type="button"
				onclick={handleNewNote}
				class="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-3 text-base text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98] md:px-6 md:text-lg"
			>
				<Plus class="h-5 w-5 md:h-6 md:w-6" />
				Create your first note
			</button>

			<!-- Tips for new users -->
			<div class="mx-auto mt-8 max-w-sm space-y-3 text-left">
				<p class="text-center text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
					Quick tips
				</p>
				{#each tips as tip}
					<div class="flex items-center gap-3 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3">
						<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-sm font-mono text-white">
							{tip.icon}
						</span>
						<span class="text-sm text-[var(--color-text-muted)]">{tip.text}</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="space-y-4">
				<p class="text-[var(--color-text-muted)]">
					You have <span class="font-semibold text-[var(--color-text)]">{$notes.length}</span>
					{$notes.length === 1 ? 'note' : 'notes'}
				</p>
				<p class="text-sm text-[var(--color-text-muted)]">
					<span class="hidden md:inline">Select a note from the sidebar or press</span>
					<span class="md:hidden">Tap the menu or press</span>
					<kbd class="mx-1 rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-xs">
						{typeof navigator !== 'undefined' && navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
					</kbd>
					to search
				</p>
				<button
					type="button"
					onclick={handleNewNote}
					class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)] active:scale-[0.98]"
				>
					<Plus class="h-4 w-4" />
					New note
				</button>
			</div>
		{/if}
	</div>
</div>
