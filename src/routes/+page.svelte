<script lang="ts">
	import { notes, addNote } from '$lib/db';
	import { goto } from '$app/navigation';
	import { Plus, FileText, Clock } from 'lucide-svelte';
	import { showNewNoteSnackbar } from '$lib/stores/snackbar';

	function handleNewNote() {
		const note = addNote();
		goto(`/note/${note.id}`);
		showNewNoteSnackbar.set(true);
	}

	// Get 3 most recently edited notes
	let recentNotes = $derived(
		[...$notes]
			.sort((a, b) => b.modified - a.modified)
			.slice(0, 3)
	);

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString();
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
			class="mx-auto mb-5 h-24 w-24 rounded-2xl shadow-lg md:mb-8 md:h-28 md:w-28"
		/>
		<h1 class="mb-3 text-3xl font-bold text-[var(--color-text)] md:text-4xl">
			Welcome to Kurumi
		</h1>
		<p class="mb-8 text-lg text-[var(--color-text-muted)] md:mb-10 md:text-xl">Your local-first second brain</p>

		{#if $notes.length === 0}
			<button
				type="button"
				onclick={handleNewNote}
				class="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-lg font-medium text-[#1e1e2e] shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-[0.98] md:px-8 md:text-xl"
				style="background: linear-gradient(135deg, #89b4fa, #cba6f7, #f5c2e7); box-shadow: 0 10px 40px -10px rgba(203, 166, 247, 0.5);"
			>
				<span class="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style="background: linear-gradient(135deg, #74c7ec, #b4befe, #f5c2e7);"></span>
				<Plus class="relative h-6 w-6 md:h-7 md:w-7" />
				<span class="relative">Create your first note</span>
			</button>

			<!-- Tips for new users -->
			<div class="mx-auto mt-10 max-w-md space-y-4 text-left">
				<p class="text-center text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
					Quick tips
				</p>
				{#each tips as tip}
					<div class="flex items-center gap-4 rounded-xl bg-[var(--color-bg-secondary)] px-5 py-4">
						<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-base font-mono text-white">
							{tip.icon}
						</span>
						<span class="text-base text-[var(--color-text-muted)]">{tip.text}</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="space-y-5">
				<p class="text-lg text-[var(--color-text-muted)]">
					You have <span class="font-semibold text-[var(--color-text)]">{$notes.length}</span>
					{$notes.length === 1 ? 'note' : 'notes'}
				</p>

				<!-- Recent Notes -->
				{#if recentNotes.length > 0}
					<div class="mx-auto mt-6 w-full max-w-md">
						<p class="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
							Jump back in
						</p>
						<div class="space-y-2">
							{#each recentNotes as note}
								<a
									href="/note/{note.id}"
									class="flex items-center gap-3 rounded-xl bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-all hover:bg-[var(--color-border)] hover:scale-[1.02] active:scale-[0.98]"
								>
									<FileText class="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
									<div class="min-w-0 flex-1">
										<p class="truncate font-medium text-[var(--color-text)]">
											{note.title || 'Untitled'}
										</p>
									</div>
									<div class="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]">
										<Clock class="h-3 w-3" />
										{formatRelativeTime(note.modified)}
									</div>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				<div class="pt-2">
					<button
						type="button"
						onclick={handleNewNote}
						class="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-6 py-3 text-base font-medium text-[#1e1e2e] shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-[0.98]"
						style="background: linear-gradient(135deg, #89b4fa, #cba6f7, #f5c2e7); box-shadow: 0 10px 40px -10px rgba(203, 166, 247, 0.5);"
					>
						<span class="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style="background: linear-gradient(135deg, #74c7ec, #b4befe, #f5c2e7);"></span>
						<Plus class="relative h-5 w-5" />
						<span class="relative">New note</span>
					</button>
				</div>

				<p class="text-sm text-[var(--color-text-muted)]">
					<span class="hidden md:inline">Select a note from the sidebar or press</span>
					<span class="md:hidden">Tap the menu or press</span>
					<kbd class="mx-1 rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs">
						{typeof navigator !== 'undefined' && navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
					</kbd>
					to search
				</p>
			</div>
		{/if}
	</div>
</div>
