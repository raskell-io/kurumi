<script lang="ts">
	/**
	 * Linking a folder as a vault, and the settings of one that is linked
	 * ($lib/linked): a folder of Markdown notes the desktop app reads where it
	 * lies. Kurumi keeps no copy of it and, for now, never writes to it.
	 */
	import { goto } from '$app/navigation';
	import { portal } from '$lib/actions/portal';
	import { autofocus } from '$lib/actions/autofocus';
	import { currentVaultId, docCurrentVaultId, setCurrentVault } from '$lib/db';
	import { isTauri } from '$lib/desktop';
	import { deleteEmbeddingsWithPrefix } from '$lib/embeddings';
	import { linkedNoteId, linkedProblem, linkedRevision, linkedStats, openLinkedVault, rescanLinkedVault } from '$lib/linked/backend';
	import { DEFAULT_IGNORE, newLinkedVaultConfig, removeLinkedVault, saveLinkedVault } from '$lib/linked/config';
	import { linkRefusal, pickLinkedFolder, type PickedFolder } from '$lib/linked/pick';
	import type { LinkedVaultConfig } from '$lib/linked/types';
	import { getLocalFSFolderPath } from '$lib/sync/local-fs';
	import { AlertTriangle, FolderOpen, Link2, RefreshCw, Unlink } from 'lucide-svelte';
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';

	interface Props {
		/** The linked vault to edit; leave out to link a new folder. */
		config?: LinkedVaultConfig;
		onclose: () => void;
	}

	let { config, onclose }: Props = $props();

	// The dialog is opened for one vault and closed again: read once.
	const editing = untrack(() => config);
	const desktop = isTauri();

	let folder = $state<PickedFolder | null>(editing ? { path: editing.path, name: editing.name } : null);
	let name = $state(editing?.name ?? '');
	// Empty = notes are linked by their title.
	let keyField = $state(editing ? (editing.linkKey === 'frontmatter' ? editing.linkKeyField : '') : 'id');
	let ignore = $state((editing?.ignore ?? DEFAULT_IGNORE).join('\n'));
	let respectGitignore = $state(editing?.respectGitignore ?? true);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let confirmUnlink = $state(false);

	let isOpen = $derived(!!editing && $currentVaultId === editing.id);
	let missing = $derived(!!editing && $linkedProblem?.vaultId === editing.id ? $linkedProblem : null);
	let stats = $derived.by(() => {
		void $linkedRevision;
		return isOpen ? linkedStats() : null;
	});

	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	async function chooseFolder() {
		error = null;
		busy = true;
		try {
			const picked = await pickLinkedFolder();
			if (!picked) return;
			const refusal = await linkRefusal(picked, await getLocalFSFolderPath());
			if (refusal) {
				error = refusal;
				return;
			}
			folder = picked;
			if (!name.trim()) name = picked.name;
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}

	function settings(): Pick<LinkedVaultConfig, 'name' | 'linkKey' | 'linkKeyField' | 'ignore' | 'respectGitignore'> {
		const field = keyField.trim();
		return {
			name: name.trim(),
			linkKey: field ? 'frontmatter' : 'title',
			linkKeyField: field || 'id',
			ignore: ignore.split('\n').map((line) => line.trim()).filter(Boolean),
			respectGitignore
		};
	}

	async function link() {
		if (!folder || !name.trim() || busy) return;
		error = null;
		busy = true;
		const created = newLinkedVaultConfig({ path: folder.path, ...settings() });
		saveLinkedVault(created);
		try {
			await openLinkedVault(created);
			onclose();
			await goto('/');
		} catch (err) {
			// A folder that can't be read isn't remembered.
			removeLinkedVault(created.id);
			error = message(err);
		} finally {
			busy = false;
		}
	}

	async function save() {
		if (!editing || !folder || !name.trim() || busy) return;
		error = null;
		busy = true;
		const updated: LinkedVaultConfig = { ...editing, ...settings(), path: folder.path };
		saveLinkedVault(updated);
		try {
			// The open vault, or one whose folder was just located, is read again.
			if (isOpen || missing) await openLinkedVault(updated);
			onclose();
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}

	async function rescan() {
		if (busy) return;
		error = null;
		busy = true;
		try {
			await rescanLinkedVault();
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}

	function unlink() {
		if (!editing) return;
		// Back to the document's own vault first; then forget the folder. Its
		// files are not touched; only the search vectors made from them go.
		if (isOpen || missing) setCurrentVault(get(docCurrentVaultId));
		removeLinkedVault(editing.id);
		void deleteEmbeddingsWithPrefix(linkedNoteId(editing.id, ''));
		onclose();
		void goto('/');
	}
</script>

<div
	use:portal
	class="k-dialog-backdrop"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="linked-dialog-title"
	tabindex="-1"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="k-dialog p-5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="document">
		<h2 id="linked-dialog-title" class="mb-1 flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
			<Link2 class="h-4 w-4 text-[var(--color-text-muted)]" />
			{editing ? 'Linked folder' : 'Link a folder'}
		</h2>

		{#if !desktop}
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				Linked folders need the desktop app. It can read a folder of Markdown notes where it lies, without keeping a copy; a browser can't do that reliably.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={onclose} class="k-btn k-btn-ghost">Close</button>
				<a href="/settings/desktop" onclick={onclose} class="k-btn k-btn-primary no-underline">Get the desktop app</a>
			</div>
		{:else}
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Kurumi shows the Markdown notes of this folder as a vault and keeps no copy of them. It is read-only for now: nothing in the folder is changed.
			</p>

			<div class="space-y-4">
				<div>
					<span class="k-label">Folder</span>
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-muted)]" title={folder?.path}>
							{folder?.path ?? 'No folder chosen'}
						</span>
						<button type="button" class="k-btn k-btn-ghost k-btn-sm shrink-0" onclick={chooseFolder} disabled={busy}>
							<FolderOpen class="h-3.5 w-3.5" />
							{editing ? 'Locate…' : folder ? 'Change…' : 'Choose folder…'}
						</button>
					</div>
					{#if missing}
						<p class="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--color-danger)]">
							<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>{missing.kind === 'missing' ? 'Folder not found. If it was moved, locate it; if its disk is unplugged, plug it in and rescan.' : missing.message}</span>
						</p>
					{/if}
				</div>

				{#if folder}
					<div>
						<label for="linked-name" class="k-label">Name</label>
						<input id="linked-name" type="text" bind:value={name} class="k-input" placeholder="Knowledge base" use:autofocus />
					</div>

					<div>
						<label for="linked-key" class="k-label">Link key field</label>
						<input id="linked-key" type="text" bind:value={keyField} class="k-input font-mono" placeholder="id" autocapitalize="off" autocomplete="off" spellcheck="false" />
						<p class="k-help">
							The frontmatter field a <code>[[link]]</code> names a note by, such as <code>id: project.foo</code>. Titles and filenames work too. Leave empty to link by title only.
						</p>
					</div>

					<div>
						<label for="linked-ignore" class="k-label">Leave out</label>
						<textarea id="linked-ignore" bind:value={ignore} rows="5" class="k-input font-mono text-xs" spellcheck="false"></textarea>
						<p class="k-help">One pattern per line, as in a .gitignore. Hidden files and folders are always left out.</p>
					</div>

					<label class="flex items-center gap-2 text-sm text-[var(--color-text)]">
						<input type="checkbox" bind:checked={respectGitignore} />
						Also leave out what the folder's .gitignore excludes
					</label>

					{#if !editing}
						<p class="text-xs text-[var(--color-text-faint)]">
							With a remote AI provider set up, text from these notes is sent to it when you ask about them, as for your other vaults.
						</p>
					{/if}
				{/if}

				{#if stats}
					<div class="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
						<div class="flex items-center gap-2">
							<span class="flex-1">
								{stats.notes} {stats.notes === 1 ? 'note' : 'notes'} in {stats.folders} {stats.folders === 1 ? 'folder' : 'folders'}{#if stats.skipped > 0}, {stats.skipped} skipped (too large or not text){/if}
							</span>
							<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={rescan} disabled={busy} title="Read the folder again">
								<RefreshCw class="h-3.5 w-3.5 {busy ? 'animate-spin' : ''}" />
								Rescan
							</button>
						</div>
						{#if stats.duplicates.length > 0}
							<p class="mt-1.5">
								{stats.duplicates.length} {stats.duplicates.length === 1 ? 'key is' : 'keys are'} used by more than one note (links go to the first by path):
								<span class="font-mono">{stats.duplicates.slice(0, 8).map((d) => d.key).join(', ')}{stats.duplicates.length > 8 ? ', …' : ''}</span>
							</p>
						{/if}
					</div>
				{/if}

				{#if error}
					<p class="flex items-start gap-1.5 text-sm text-[var(--color-danger)]" role="alert">
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
						<span>{error}</span>
					</p>
				{/if}
			</div>

			{#if editing}
				<div class="mt-5 border-t border-[var(--color-border)] pt-4">
					{#if !confirmUnlink}
						<button onclick={() => (confirmUnlink = true)} class="k-btn k-btn-ghost k-btn-sm !text-[var(--color-danger)]">
							<Unlink class="h-3.5 w-3.5" />
							Unlink this folder…
						</button>
					{:else}
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Kurumi forgets this folder. The folder and its files stay exactly as they are.
						</p>
						<div class="flex justify-end gap-2">
							<button onclick={() => (confirmUnlink = false)} class="k-btn k-btn-ghost k-btn-sm">Cancel</button>
							<button onclick={unlink} class="k-btn k-btn-danger k-btn-sm">Unlink</button>
						</div>
					{/if}
				</div>
			{/if}

			<div class="mt-5 flex justify-end gap-2">
				<button onclick={onclose} class="k-btn k-btn-ghost">Cancel</button>
				<button onclick={editing ? save : link} disabled={!folder || !name.trim() || busy} class="k-btn k-btn-primary">
					{editing ? 'Save' : busy ? 'Reading the folder…' : 'Link folder'}
				</button>
			</div>
		{/if}
	</div>
</div>
