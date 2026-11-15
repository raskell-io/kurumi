<script lang="ts">
	/**
	 * Linking a folder as a vault, and the settings of one that is linked
	 * ($lib/linked): a folder of Markdown notes the desktop app reads where it
	 * lies. Kurumi keeps no copy of it, and writes to it only when editing is
	 * turned on here.
	 */
	import { goto } from '$app/navigation';
	import { portal } from '$lib/actions/portal';
	import { autofocus } from '$lib/actions/autofocus';
	import { currentVaultId, docCurrentVaultId, setCurrentVault } from '$lib/db';
	import { isTauri } from '$lib/desktop';
	import { deleteEmbeddingsWithPrefix } from '$lib/embeddings';
	import { linkedNoteId, linkedProblem, linkedRevision, linkedStats, linkedWatch, openLinkedVault, rescanLinkedVault } from '$lib/linked/backend';
	import { DEFAULT_IGNORE, newLinkedVaultConfig, removeLinkedVault, saveLinkedVault } from '$lib/linked/config';
	import { linkRefusal, pickLinkedFolder, probeFolder, type Conventions, type PickedFolder } from '$lib/linked/pick';
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
	const defaults = editing ?? newLinkedVaultConfig({ name: '', path: '' });

	let folder = $state<PickedFolder | null>(editing ? { path: editing.path, name: editing.name } : null);
	let name = $state(defaults.name);
	// Empty = notes are linked by their title.
	let keyField = $state(defaults.linkKey === 'frontmatter' ? defaults.linkKeyField : '');
	let ignore = $state((editing?.ignore ?? DEFAULT_IGNORE).join('\n'));
	let respectGitignore = $state(defaults.respectGitignore);
	// Conventions: which frontmatter fields mean what. Empty = not used.
	let titleField = $state(defaults.titleField ?? '');
	let summaryField = $state(defaults.summaryField ?? '');
	let tagFields = $state(defaults.tagFields.join(', '));
	// Editing.
	let allowEditing = $state(!defaults.readOnly);
	let updatedField = $state(defaults.updatedField ?? '');
	let updatedFormat = $state(defaults.updatedFormat);
	let newNoteDir = $state(defaults.newNoteDir);
	let newNoteFilename = $state(defaults.newNoteFilename);
	let newNoteTemplate = $state(defaults.newNoteTemplate);

	let found = $state<Conventions | null>(null);
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
	const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
	const percent = (count: number, of: number) => `${Math.round((count / Math.max(of, 1)) * 100)}%`;

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
			if (!editing) {
				// A first look at the notes, to suggest the settings below.
				found = await probeFolder(picked, lines(ignore), respectGitignore).catch(() => null);
				if (found) {
					keyField = found.keyField ?? '';
					titleField = found.titleField ?? '';
				}
			}
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}

	function settings(): Partial<LinkedVaultConfig> {
		const field = keyField.trim();
		return {
			name: name.trim(),
			linkKey: field ? 'frontmatter' : 'title',
			linkKeyField: field || 'id',
			ignore: lines(ignore),
			respectGitignore,
			titleField: titleField.trim() || null,
			summaryField: summaryField.trim() || null,
			tagFields: tagFields.split(',').map((f) => f.trim()).filter(Boolean),
			readOnly: !allowEditing,
			updatedField: updatedField.trim() || null,
			updatedFormat,
			newNoteDir: newNoteDir.trim().replace(/^\/+|\/+$/g, ''),
			newNoteFilename: newNoteFilename.trim() || '{title}',
			newNoteTemplate
		};
	}

	async function link() {
		if (!folder || !name.trim() || busy) return;
		error = null;
		busy = true;
		const created = newLinkedVaultConfig({ name: name.trim(), path: folder.path, ...settings() });
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
			// The open vault, or one whose folder was just located, is read again
			// (its notes depend on these settings).
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
	data-testid="linked-vault-dialog"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="k-dialog max-h-[90vh] overflow-y-auto p-5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="document">
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
				Kurumi shows the Markdown notes of this folder as a vault and keeps no copy of them. It only reads the folder unless you turn on editing below.
			</p>

			<div class="space-y-4">
				<div>
					<span class="k-label">Folder</span>
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-muted)]" title={folder?.path} data-testid="linked-folder-path">
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
					{#if found}
						<p class="k-help" data-testid="linked-conventions">
							{found.notes} {found.notes === 1 ? 'note' : 'notes'}, {found.withFrontmatter} with frontmatter{#if found.fields.length}: {found.fields.slice(0, 6).map((f) => `${f.name} (${percent(f.count, found!.withFrontmatter)})`).join(', ')}{/if}. The settings below start from that.
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

					<details class="group rounded-md border border-[var(--color-border)] px-3 py-2">
						<summary class="cursor-pointer text-sm font-medium text-[var(--color-text)]">Frontmatter fields</summary>
						<div class="mt-3 space-y-3">
							<div>
								<label for="linked-title-field" class="k-label">Title field</label>
								<input id="linked-title-field" type="text" bind:value={titleField} class="k-input font-mono" placeholder="title" autocapitalize="off" spellcheck="false" />
								<p class="k-help">Notes without it, or with this empty, are titled by their first heading, else their filename.</p>
							</div>
							<div>
								<label for="linked-summary-field" class="k-label">Summary field</label>
								<input id="linked-summary-field" type="text" bind:value={summaryField} class="k-input font-mono" placeholder="summary" autocapitalize="off" spellcheck="false" />
							</div>
							<div>
								<label for="linked-tag-fields" class="k-label">Fields shown as tags</label>
								<input id="linked-tag-fields" type="text" bind:value={tagFields} class="k-input font-mono" placeholder="type, status" autocapitalize="off" spellcheck="false" />
								<p class="k-help">Comma-separated. <code>type: project</code> becomes the tag <code>type/project</code>. A <code>tags</code> list is always read.</p>
							</div>
						</div>
					</details>

					<details class="group rounded-md border border-[var(--color-border)] px-3 py-2">
						<summary class="cursor-pointer text-sm font-medium text-[var(--color-text)]">Files left out</summary>
						<div class="mt-3 space-y-3">
							<div>
								<label for="linked-ignore" class="k-label">Leave out</label>
								<textarea id="linked-ignore" bind:value={ignore} rows="5" class="k-input font-mono text-xs" spellcheck="false"></textarea>
								<p class="k-help">One pattern per line, as in a .gitignore. Hidden files and folders are always left out.</p>
							</div>
							<label class="flex items-center gap-2 text-sm text-[var(--color-text)]">
								<input type="checkbox" bind:checked={respectGitignore} />
								Also leave out what the folder's .gitignore excludes
							</label>
						</div>
					</details>

					<div class="rounded-md border border-[var(--color-border)] px-3 py-2">
						<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
							<input type="checkbox" class="mt-0.5" bind:checked={allowEditing} data-testid="linked-allow-editing" />
							<span>
								<span class="font-medium">Allow editing</span>
								<span class="block text-xs text-[var(--color-text-muted)]">
									Kurumi then saves your changes to the files: only the lines you changed, the frontmatter untouched, and never over a change made elsewhere.
								</span>
							</span>
						</label>
						{#if allowEditing}
							<div class="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
								<div class="flex items-end gap-2">
									<div class="min-w-0 flex-1">
										<label for="linked-updated-field" class="k-label">"Updated" field</label>
										<input id="linked-updated-field" type="text" bind:value={updatedField} class="k-input font-mono" placeholder="none" autocapitalize="off" spellcheck="false" />
									</div>
									<select class="k-input !w-auto" bind:value={updatedFormat} aria-label="Format of the updated field">
										<option value="date">Date</option>
										<option value="datetime">Date and time</option>
									</select>
								</div>
								<p class="k-help !mt-1">If a note has this frontmatter field, saving a change to its text sets it to today.</p>
								<div>
									<label for="linked-new-dir" class="k-label">New notes go to</label>
									<input id="linked-new-dir" type="text" bind:value={newNoteDir} class="k-input font-mono" placeholder="the top of the folder" autocapitalize="off" spellcheck="false" />
								</div>
								<div>
									<label for="linked-new-name" class="k-label">New note filename</label>
									<input id="linked-new-name" type="text" bind:value={newNoteFilename} class="k-input font-mono" placeholder={'{title}'} autocapitalize="off" spellcheck="false" />
								</div>
								<div>
									<label for="linked-new-template" class="k-label">New notes start with</label>
									<textarea id="linked-new-template" bind:value={newNoteTemplate} rows="4" class="k-input font-mono text-xs" spellcheck="false" placeholder={'---\nid: note.{id}\ntitle: {title}\ncreated: {date}\n---'}></textarea>
									<p class="k-help"><code>{'{title}'}</code>, <code>{'{date}'}</code> and <code>{'{id}'}</code> (the title as a slug) are filled in. Empty: the file starts with nothing.</p>
								</div>
							</div>
						{/if}
					</div>

					{#if !editing}
						<p class="text-xs text-[var(--color-text-faint)]">
							With a remote AI provider set up, text from these notes is sent to it when you ask about them, as for your other vaults.
						</p>
					{/if}
				{/if}

				{#if stats}
					<div class="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
						<div class="flex items-center gap-2">
							<span class="flex-1" data-testid="linked-stats">
								{stats.notes} {stats.notes === 1 ? 'note' : 'notes'} in {stats.folders} {stats.folders === 1 ? 'folder' : 'folders'}{#if stats.skipped > 0}, {stats.skipped} skipped (too large or not text){/if}
							</span>
							<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={rescan} disabled={busy} title="Read the folder again">
								<RefreshCw class="h-3.5 w-3.5 {busy ? 'animate-spin' : ''}" />
								Rescan
							</button>
						</div>
						<p class="mt-1.5" data-testid="linked-watch">
							{#if $linkedWatch === 'events'}
								Changes in the folder show up here right away.
							{:else if $linkedWatch === 'polling'}
								Watching is limited on this disk: changes in the folder show up after a few seconds.
							{:else}
								Watching the folder stopped. Rescan reads it again.
							{/if}
						</p>
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
