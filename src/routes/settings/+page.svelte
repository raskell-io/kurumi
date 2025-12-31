<script lang="ts">
	import { exportNotesJSON, notes } from '$lib/db';
	import { onMount } from 'svelte';
	import { Monitor, Sun, Moon } from 'lucide-svelte';

	let syncToken = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-token') || '' : '');
	let syncUrl = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-url') || '' : '');
	let showSaved = $state(false);
	let theme = $state<'system' | 'light' | 'dark'>('system');

	onMount(() => {
		const savedTheme = localStorage.getItem('kurumi-theme') as 'system' | 'light' | 'dark' | null;
		if (savedTheme) {
			theme = savedTheme;
		}
	});

	function setTheme(t: 'system' | 'light' | 'dark') {
		theme = t;
		localStorage.setItem('kurumi-theme', t);
		if (t === 'system') {
			document.documentElement.classList.remove('light', 'dark');
		} else {
			document.documentElement.classList.remove('light', 'dark');
			document.documentElement.classList.add(t);
		}
	}

	function saveSyncSettings() {
		localStorage.setItem('kurumi-sync-token', syncToken);
		localStorage.setItem('kurumi-sync-url', syncUrl);
		showSaved = true;
		setTimeout(() => (showSaved = false), 2000);
	}

	function handleExport() {
		const json = exportNotesJSON();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `kurumi-export-${new Date().toISOString().split('T')[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="h-full overflow-y-auto overscroll-contain p-4 md:p-6">
	<div class="mx-auto max-w-2xl">
		<h1 class="mb-6 text-xl font-bold text-[var(--color-text)] md:mb-8 md:text-2xl">Settings</h1>

		<!-- Theme -->
		<section class="mb-6 md:mb-8">
			<h2 class="mb-3 text-base font-semibold text-[var(--color-text)] md:mb-4 md:text-lg">
				Theme
			</h2>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Choose your preferred color scheme.
			</p>

			<div class="flex flex-wrap gap-2">
				<button
					onclick={() => setTheme('system')}
					class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'system' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
				>
					<Monitor class="h-5 w-5" />
					System
				</button>
				<button
					onclick={() => setTheme('light')}
					class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'light' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
				>
					<Sun class="h-5 w-5" />
					Light
				</button>
				<button
					onclick={() => setTheme('dark')}
					class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'dark' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
				>
					<Moon class="h-5 w-5" />
					Dark
				</button>
			</div>
		</section>

		<!-- Sync Settings -->
		<section class="mb-6 md:mb-8">
			<h2 class="mb-3 text-base font-semibold text-[var(--color-text)] md:mb-4 md:text-lg">
				Cloudflare Sync
			</h2>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Configure sync with your Cloudflare R2 Worker to access notes across devices.
			</p>

			<div class="space-y-4">
				<div>
					<label for="syncUrl" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
						Sync Worker URL
					</label>
					<input
						id="syncUrl"
						type="url"
						bind:value={syncUrl}
						placeholder="https://kurumi-sync.your-domain.workers.dev/sync"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>

				<div>
					<label for="syncToken" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
						Sync Token
					</label>
					<input
						id="syncToken"
						type="password"
						bind:value={syncToken}
						placeholder="Your sync authentication token"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>

				<button
					onclick={saveSyncSettings}
					class="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98] md:w-auto"
				>
					{showSaved ? 'Saved!' : 'Save Sync Settings'}
				</button>
			</div>
		</section>

		<!-- Export -->
		<section class="mb-6 md:mb-8">
			<h2 class="mb-3 text-base font-semibold text-[var(--color-text)] md:mb-4 md:text-lg">
				Export Data
			</h2>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Export all your notes as JSON for backup or migration.
			</p>

			<div class="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
				<button
					onclick={handleExport}
					class="w-full rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] md:w-auto"
				>
					Export as JSON
				</button>
				<span class="text-center text-sm text-[var(--color-text-muted)] md:text-left">
					{$notes.length} notes
				</span>
			</div>
		</section>

		<!-- About -->
		<section class="mb-8">
			<h2 class="mb-3 text-base font-semibold text-[var(--color-text)] md:mb-4 md:text-lg">
				About
			</h2>
			<div
				class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
			>
				<div class="flex items-center gap-3">
					<img src="/icon-192.avif" alt="Kurumi" class="h-12 w-12 rounded-lg" />
					<div>
						<h3 class="font-semibold text-[var(--color-text)]">Kurumi</h3>
						<p class="text-sm text-[var(--color-text-muted)]">
							Your local-first second brain
						</p>
					</div>
				</div>
				<div class="mt-4 text-sm text-[var(--color-text-muted)]">
					<p>Version 0.1.0</p>
					<p class="mt-1">
						Built with SvelteKit, Automerge, and Tailwind CSS.
						<br />
						Data stored locally using IndexedDB.
					</p>
				</div>
			</div>
		</section>

		<!-- Bottom safe area spacer -->
		<div class="h-8 safe-bottom md:h-0"></div>
	</div>
</div>
