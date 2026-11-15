# Linked folder vault (desktop): implementation plan

Status: proposal, not started. Written from a read of the code; nothing was built or run, so crate versions, Tauri behaviours and timings are unverified. Items marked **(assumed)** were not found in the repository.

---

## 1. Summary

A linked vault is a vault whose notes are the Markdown files of a folder another tool owns. Kurumi keeps no stored copy of it. The desktop app scans the folder into memory at start, watches it, and writes a note back to its own file when it is edited.

Recommendation: **a file-backed vault backend behind the existing store facade (`$lib/db`)**, with a memory-only read model. Linked vaults and their config are per device and never enter the Automerge document. The feature is desktop-only; the web/PWA build does not offer it.

## 2. What the code looks like today (findings that shape the design)

1. **Everything reads through `$lib/db`.** 54 files read the `memoryObjects` store; search (`src/lib/search/index.ts` `syncIndex`), embeddings (`src/lib/embeddings.ts` `runIndexing`, `semanticSearch`), Ask (`src/lib/ask.ts` `retrieveMemoryContext`) and the graph (`src/routes/graph/+page.svelte`, `src/lib/components/Graph.svelte`) all take notes from `memoryObjects` / `getMemoryObject`. If linked notes appear in those two, most read features work without change.
2. **Editing has one choke point.** The note page (`src/routes/memory/[id]/+page.svelte`, `flushPendingSave`, `saveLiveContent`) and the pagehide stash (`src/lib/unsaved.ts`) save through `updateMemoryObject(id, { title, bodyMarkdown })` in `src/lib/db/store.ts`.
3. **The current vault is synced state.** `setCurrentVault` writes `d.currentVaultId` into the Automerge document. Making a linked vault "current" that way would push a vault id other devices do not have.
4. **Sync takes its scope from the same stores.** `src/lib/sync/service.ts` uses `get(vaults)`, `get(currentVaultId)`, `vaultMemories()` and `getVaultContents()` for the local-folder mirror (line 818), blob sync and git (line 1121). If linked vaults appeared in those unguarded, sync would mirror the linked folder into the sync target, which is exactly the divergent copy requirement 1 forbids.
5. **Link resolution by title is spread over about ten places:** `findBacklinks`, `findMemoryObjectByTitle`, `findUnlinkedMentions` (`store.ts`); `src/lib/graph-walk.ts` `index()` (`byTitle`); `src/routes/graph/+page.svelte` line 18; `Graph.svelte` lines 181–208; `MarkdownRenderer.svelte` lines 141, 212; `SplitPane.svelte` line 72; `NoteEmbed.svelte` line 20; `src/routes/memory/[id]/+page.svelte` line 730; `src/routes/read/[id]/+page.svelte` line 143; `src/lib/editor/linkSuggest.ts`; `WikilinkAutocomplete.svelte`.
6. **Background writers scan all notes.** `reconcileNoteTasks` (`store.ts`) walks `memoriesView()` and turns checkbox lines into `ActionItem`s; the daily digest (`src/lib/digest.ts`), weekly review, living notes, workflows and the agent (`src/lib/agent.ts` line 421) create notes with `addMemoryObject` / `putGeneratedNote`.
7. **The desktop side already has a narrow, tested file layer.** `desktop/src-tauri/src/folders.rs` has `Folders::authorize` (picked roots only, symlinks resolved, remembered in `folders.json`), an atomic `write` (temp file, `sync_all`, rename) and `folder_pick`. The capability file (`capabilities/default.json`) grants only `core:default` and `notification:default`. The web side calls `window.__TAURI_INTERNALS__.invoke` directly (`src/lib/desktop/folder-handle.ts`); `@tauri-apps/api` is not a dependency.
8. **Existing Local sync is the opposite model.** `src/lib/sync/local-fs.ts` writes `kurumi-sync.bin`, `.kurumi/metadata.json`, `.kurumi/AGENTS.md` (from `src/lib/sync/agent-guide.md`), `.kurumi/archive/`, `.kurumi/rescued/` and `.claude/CLAUDE.md` (`claude-instructions.ts`), and rewrites frontmatter with `generateFrontMatter` in `src/lib/git/convert.ts` (`id`, `name`, `created`, `modified`, `tags`, `icon`). `parseMarkdownFile` would also take a foreign `id: project.foo` as the Kurumi note id. It polls every 5 s (`FOLDER_WATCH_MS`).
9. **Two frontmatter parsers exist, both lossy:** `parseFrontMatter` in `git/convert.ts` (single-line values) and `parseFrontmatter` / `serializeFrontmatter` in `src/lib/utils/frontmatter.ts` (re-serialises, changes quoting). Neither can be used to write a foreign file back.
10. **`Editor.svelte` has no read-only prop**, and Milkdown re-serialises the whole body on the first edit (the code base already notes escaped `\[\[` forms and list spreading).

## 3. Key design decision

### Alternatives

| | (a) Project the folder into the existing store | (b) File-backed vault backend behind the store facade | (c) Local sync with a "foreign folder" mode |
|---|---|---|---|
| What it is | On open, insert the files as `MemoryObject`s into the Automerge document (or an "ephemeral" part of it); write changes back out | A second backend for notes and folders. The Automerge document is one backend; the linked backend holds notes in a memory-only map fed by Rust and writes edits to files. `$lib/db` exports present both | Keep `syncLocalFS`, switch off its own artefacts, add foreign frontmatter handling |
| Requirement 1 (one truth, no copy) | Fails unless every persistence and sync path is taught to skip those records: `saveDoc`, `getDocBinary`, `mergeDoc`, `mergeRecords`, `exportFullJSON`, git and folder mirrors. One missed path stores or uploads a copy. Automerge history would also record every external change | Holds by construction: linked notes are never in `doc`, so nothing that serialises `doc` can contain them | Fails by design: the document stays the truth and the folder a mirror, so there are always two copies and a merge (`text-merge.ts`, `folder-state.ts` base texts) |
| Requirement 2 (frontmatter byte-for-byte) | Possible, with a side table for raw frontmatter | Natural: raw frontmatter bytes stay on the in-memory entry | Against the grain: `noteToMarkdownFile` always regenerates frontmatter; ids clash |
| Requirement 4 (live, conflict detection) | Needs the same Rust work as (b) | Rust watcher plus hash-guarded writes | 5 s polling, merge on both-sides edits |
| Cost | Looks cheapest, but the exclusion audit never ends | A routing layer in `store.ts`, new Rust module, link resolver | Large changes to a 1,000-line module with strong invariants ("the sync never deletes", archive, rescue) that do not apply here |

### Recommendation: (b), with a memory-only read model

- Linked notes live in `Map<id, MemoryObject>` owned by a new module, not in the Automerge document and not in IndexedDB. This is the "projection" idea of (a) without touching `doc`.
- **Fail closed.** `memoriesView()` and `getCurrentVaultId()` in `store.ts` stay document-only. Read paths opt in to linked notes explicitly. A path nobody opted in is a feature missing in linked vaults, never linked data leaking into the document, a to-do, a sync upload or a backup.
- Derived caches are allowed because they are rebuildable and keyed by content: the MiniSearch index (memory only) and embedding vectors (`kurumi-embeddings` in IndexedDB, keyed by note id with a content hash). Vectors are not note text; they are deleted when a vault is unlinked. This is the one place Kurumi stores anything derived from the folder, and it is called out in the open questions.

## 4. Data model

### 4.1 Types (new file `src/lib/linked/types.ts`)

```ts
export type VaultKind = 'kurumi' | 'linked';

export interface LinkedVaultConfig {
  id: string;              // 'lv-' + 8 random chars; device-local
  name: string;
  icon?: string;
  path: string;            // absolute, canonical, as returned by folder_pick
  linkKey: 'frontmatter' | 'title' | 'filename';
  linkKeyField: string;    // default 'id'; used when linkKey is 'frontmatter'
  linkFallback: ('title' | 'filename')[]; // tried in order when the key misses
  titleField: string | null;   // default 'title'; null = first H1, else filename
  summaryField: string | null; // default 'summary'  -> MemoryObject.summaryShort
  tagFields: string[];         // default ['type', 'status'] -> tags 'type/x', 'status/y'
  ignore: string[];            // gitignore-style patterns
  respectGitignore: boolean;   // default true
  readOnly: boolean;           // default true
  updatedField: string | null; // default null; e.g. 'updated'
  updatedFormat: 'date' | 'datetime'; // YYYY-MM-DD or ISO 8601
  created: number;
}

export interface VaultCapabilities {
  kind: VaultKind;
  editNotes: boolean;      // false when readOnly
  createNotes: boolean;    // false until milestone 5
  records: boolean;        // to-dos, projects, decisions, questions, meetings, people, events
  sync: boolean;
  generated: boolean;      // digest, weekly review, living notes, workflows
}
```

Default ignore list: `.git/`, `.obsidian/`, `.trash/`, `node_modules/`, `target/`, `.kurumi/`, `.claude/`. Dot-directories are always skipped. The motivating setup would add `cli/`, `hooks/`, `INDEX.md`, `graph.json`.

### 4.2 Where config is stored

- `localStorage['kurumi-linked-vaults']`: `LinkedVaultConfig[]` (same pattern as `kurumi-local-fs-all-vaults` and other per-device settings).
- `localStorage['kurumi-active-linked-vault']`: id of the linked vault that is current on this device, or absent.
- The path's authorisation is the existing `folders.json` in the app config directory, written by `Folders::add`. So the path is remembered twice on purpose: the web side knows what to open, the Rust side decides what may be opened.
- **Not** in `KurumiDocument`: no schema bump (stays v17), no `minAppVersion` change, nothing for other devices to trip over, no local path in sync storage.

### 4.3 Changes to existing types and store (`src/lib/db/types.ts`, `src/lib/db/store.ts`)

- `Vault` gains optional, never-persisted `kind?: VaultKind` (absent means `'kurumi'`). Linked vaults are turned into `Vault` objects for display only.
- `MemoryObject` is unchanged in shape. A linked note is built with `createMemoryObject` defaults plus:
  - `id`: `lf.<vaultId>.<base64url(relative path)>`. Reversible, stable across restarts, safe in `/memory/[id]` routes, cannot collide with document ids.
  - `title` from `titleField`, else first H1, else filename; `bodyMarkdown` = file content after the frontmatter block; `summaryShort` from `summaryField`; `tags` from `tagFields` plus a YAML `tags` list if present; `updatedAt` = file mtime; `createdAt` = file birth time or mtime; `folderId` = synthetic folder id; `vaultId` = linked vault id.
- Side data per linked note (in the backend, not on `MemoryObject`): `relPath`, `rawFrontmatter` (exact bytes including delimiters and the newline style), `frontmatter` (parsed, read-only), `baseHash` (SHA-256 of the file as last read or written), `mtime`, `linkKeyValue`.
- Synthetic `Folder`s: one per directory, id `lfd.<vaultId>.<base64url(dir path)>`, `name` = directory name as written (no slugging).

`store.ts` changes, all small:

| Symbol | Change |
|---|---|
| `vaults` | Stays document-only under a new export name `docVaults`; `vaults` becomes `docVaults` plus linked vaults. |
| `currentVaultId` | Returns the active linked id when set, else `doc.currentVaultId`. New export `docCurrentVaultId` (document-only). |
| `setCurrentVault(id)` | Linked id: set the local override only, no `updateDoc`. Document id: clear the override, then today's behaviour. |
| `currentVault`, `memoryObjects`, `folders`, `allMemoryObjects`-like readers | Take linked data when the current vault is linked, via a `linkedRevision` store the backend bumps. `allMemoryObjects` stays document-only (it feeds `unsaved.ts` restore; see 6.6). |
| `getMemoryObject`, `getFolder`, `getFolderPath`, `getSubfolders`, `getMemoryObjectsInFolder` | Route by id prefix (`lf.` / `lfd.`). |
| `updateMemoryObject` | Linked id: hand `title`/`bodyMarkdown` to the backend; ignore other fields. |
| `findBacklinks`, `findMemoryObjectByTitle`, `findUnlinkedMentions`, `getAllTags`, `getMemoryObjectsByTag` | Delegate to the link resolver / linked read model when the vault is linked. |
| `deleteMemoryObject`, `moveMemoryObjectToFolder`, `setMemoryIcon`, `setMemoryFavorite`, `setMemoryCustomProp`, `addFolder`, `updateFolder`, `deleteFolder`, `moveMemoryObjectToVault`, `moveFolderToVault` | No-op with `showNotice` for linked ids (the UI hides them too). |
| `memoriesView()`, `getCurrentVaultId()`, `getVaultContents`, `getDocBinary`, `mergeDoc`, `exportFullJSON`, `reconcileNoteTasks` | Unchanged, document-only. Records created while a linked vault is active (should the UI miss a gate) land in the document's own current vault, not in limbo. |
| new `currentVaultCaps: Readable<VaultCapabilities>` | For UI gating. |

`src/lib/sync/service.ts`: replace `vaults` / `currentVaultId` imports with `docVaults` / `docCurrentVaultId`, and make `vaultMemories()` read `getVaultContents(docCurrentVaultId)`. That is the whole sync change; a unit test pins it.

## 5. Rust / Tauri side

New module `desktop/src-tauri/src/linked.rs`, registered in `lib.rs` (`mod linked;`, `app.manage(linked::Linked::default())`, commands added to `generate_handler!`). Desktop only (`#[cfg(desktop)]`; the mobile build returns "not available", like `pick_folder`).

### 5.1 Commands

| Command | Arguments | Returns | Notes |
|---|---|---|---|
| `folder_pick` (existing) | – | `{ path, name }` | Reused unchanged to choose and authorise the folder. |
| `linked_open` | `{ vault, root, ignore, respectGitignore }` | `{ cursor, notes: NoteFile[], dirs: string[], skipped: number }` | `Folders::authorize(root)`, full scan, start watcher. Idempotent per `vault`; re-opening replaces the previous watcher. |
| `linked_changes` | `{ vault, cursor }` | `{ cursor, changes: Change[], rescan: bool }` | Async long poll: resolves when changes exist or after 25 s. |
| `linked_read` | `{ vault, rel }` | `NoteFile` | Fresh read of one file (conflict dialog, reload). |
| `linked_write` | `{ vault, rel, expectedHash, content }` | `{ hash, mtime }` or error `ConflictError: <currentHash>` | Atomic, hash-guarded (5.3). |
| `linked_create` | `{ vault, rel, content }` | `{ hash, mtime }` | `create_new` semantics; fails if the file exists. Milestone 5. |
| `linked_close` | `{ vault }` | – | Stops the watcher, drops state. |

```rust
struct NoteFile { rel: String, content: String, hash: String, mtime: f64, size: u64 }
enum Change { Upsert(NoteFile), Remove { rel: String } }
```

`rel` is always `/`-separated and relative to the root. Errors keep the existing convention of DOMException-style prefixes (`NotAllowedError:`, `NotFoundError:`), adding `ConflictError:`.

### 5.2 Scanning and watching

- **Walking and ignore rules:** the `ignore` crate (`WalkBuilder` with the per-vault patterns as overrides, `.gitignore` honoured when `respectGitignore`, hidden entries skipped). The same matcher filters watcher events. Only `.md` / `.markdown` are returned (matching `MARKDOWN_FILE` in `local-fs.ts`). Files over 2 MB or not valid UTF-8 are counted in `skipped`, not returned.
- **Watching:** `notify` with `notify-debouncer-full` (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows), recursive on the root, about 300 ms debounce. Neither crate is in `Cargo.lock` today; `sha2`, `walkdir` and `tokio` already are (transitively). Pin exact versions like the other dependencies. **(assumed: current versions and API; verify before M2.)**
- **Why not `tauri-plugin-fs` with its watch feature:** it would open a general file API to the webview and need scope entries in the capability file. The repository's stated rule is that folder access goes only through its own commands (`capabilities/default.json` description, `desktop/README.md`).
- **Change delivery by long poll with a cursor**, not events. Reasons: no new JS dependency (the app calls `__TAURI_INTERNALS__.invoke` directly), no capability change, nothing lost across a webview reload (the cursor is replayed), and `selftest.js` can drive it with plain `invoke`. Rust keeps a bounded change log per vault (say 5,000 entries); a cursor older than the log returns `rescan: true` and the web side calls `linked_open` again. Alternative considered: `app.emit` plus `@tauri-apps/api/event`; simpler Rust, but adds a dependency and loses events while the page reloads.
- **Self-writes are suppressed by content:** after `linked_write`, Rust records the new hash for that path; a watcher event whose file hash equals the recorded one is dropped. This follows the principle in `src/lib/sync/folder-state.ts` ("by content, not clocks").
- **Bursts** (`git pull`, branch switch): the debouncer batches; above a threshold (say 500 paths in one batch) Rust emits `rescan: true` instead of individual changes.
- **Fallback:** if the watcher cannot start (inotify limit, network share), Rust falls back to a 5 s rescan diff by mtime and size, then hash. The web side shows "Watching is limited on this folder" in the vault settings.

### 5.3 Atomic write and conflict detection

`linked_write` does, under a per-path mutex:

1. `authorize` the joined path (reusing `Folders::authorize`, so `..`, absolute escapes and symlinks out of the root are refused).
2. Read the current file and hash it (SHA-256 via `sha2`). If it differs from `expectedHash`, return `ConflictError:` with the current hash. A missing file returns `NotFoundError:`.
3. Write `.<name>.kurumi-tmp` beside it, `sync_all`, copy the original's permission bits, rename over the target. This is the existing `write` in `folders.rs`; factor the body out into a shared `atomic_write(path, bytes)`.
4. Return the new hash and mtime; record the hash for self-write suppression.

mtime is used only as a cheap pre-check in the fallback rescan and for display; the decision is by hash. The remaining window between step 2 and the rename is a few milliseconds and is documented as a known limit.

The temporary file is the only thing Kurumi ever creates in the folder besides note files; it is hidden, lives for milliseconds and is removed on failure. If even that is unacceptable, the alternative is writing the temp file in the app cache directory, which loses atomicity across file systems (open question 6).

### 5.4 Security

- Roots come only from the system dialog (`folder_pick`), never from a typed path, so page script or a plugin cannot widen access. `linked_open` refuses a root that is not itself an authorised root.
- All paths are `root.join(rel)` after rejecting absolute `rel`, `..` and `.` components, then `authorize`.
- The scan does not follow symlinks that resolve outside the root.
- `linked_write` and `linked_create` refuse paths the ignore rules exclude and anything not ending in `.md` / `.markdown`, so the web side cannot be used to write into `.git/` or hooks.
- Read-only is enforced on both sides: `linked_open` takes `readOnly`, and Rust rejects writes for that vault.
- No capability change: app commands are not ACL-gated (no `AppManifest` in `build.rs`), and the long poll needs no event permission. Update only the `description` in `capabilities/default.json` to mention `linked.rs`.
- macOS: the app is not sandboxed (no entitlements file found), so no security-scoped bookmarks are needed; folders under Documents/Desktop/Downloads trigger the system privacy prompt once.

### 5.5 Rust tests (`cargo test` in `desktop/src-tauri`, already run by `desktop.yml`)

Scan honours ignore patterns and `.gitignore`; write with a stale hash returns `ConflictError` and leaves the file intact; write preserves bytes exactly (CRLF, no trailing newline, BOM); no temp file left behind; paths outside the root, into `.git/`, and through symlinks are refused; read-only vault rejects writes; watcher reports create/modify/remove/rename and suppresses a self-write.

## 6. TypeScript side

### 6.1 New modules (`src/lib/linked/`)

| File | Purpose |
|---|---|
| `types.ts` | Section 4.1. |
| `config.ts` | Load/save `LinkedVaultConfig[]`, active id, defaults, validation. |
| `frontmatter.ts` | `splitFrontmatter(text) -> { raw, body, eol }` (raw bytes kept verbatim, CRLF-aware); `readFrontmatterFields(raw)` for display only; `setScalarField(raw, key, value)` which edits exactly one existing `key: value` line and returns `raw` unchanged if the key is absent or its value is not a single-line scalar; `joinNote(raw, body)`. Never re-serialises. |
| `backend.ts` | The read model: maps of notes and folders by id, `linkedRevision` store, `openLinkedVault`, `closeLinkedVault`, the long-poll loop, applying `Change`s, building `MemoryObject`s, the save queue and conflict state. Talks to Rust through an `invoke` helper exported from `src/lib/desktop/` (move the private `invoke` in `folder-handle.ts` to a small shared file). |
| `links.ts` | `buildLinkIndex(notes, keyOf)` and `LinkResolver` (6.3). Pure, unit-testable. |
| `write-back.ts` | Minimal-diff body save (6.5). Pure. |
| `capabilities.ts` | `capabilitiesFor(vault)` and the `currentVaultCaps` store. |

### 6.2 Boot and lifecycle

- `src/routes/+layout.svelte`, after `initDB()`: if `isTauri()` and an active linked vault is configured, `await openLinkedVault(config)` before `initSearch()`. If the folder is missing (unmounted disk, moved repo), show the vault as "Folder not found" with *Locate…* and *Unlink*, and fall back to the document's current vault. Nothing is deleted or forgotten automatically.
- Only the active linked vault is mounted (scanned and watched). Switching vaults closes the old one. This keeps memory bounded and matches how `memoryObjects` is per-vault today.
- The existing `$effect` that calls `syncIndex()` on `$memoryObjects` changes needs no edit: `memoryObjects` re-emits when `linkedRevision` bumps, and `syncIndex` re-indexes by `updatedAt` (file mtime).

### 6.3 Link resolution by key

`LinkResolver` (one per vault, rebuilt incrementally on changes):

```ts
interface LinkResolver {
  resolve(target: string): MemoryObject | undefined;   // by key, then fallbacks; case-insensitive
  keyOf(note: MemoryObject): string;                   // what [[...]] should contain for this note
  backlinks(id: string): MemoryObject[];
  outgoing(id: string): MemoryObject[];
  duplicates(): { key: string; ids: string[] }[];
}
```

- For Kurumi vaults the resolver is "title, case-insensitive", i.e. today's behaviour, so call sites can switch unconditionally.
- For linked vaults, a note is addressable by `frontmatter[linkKeyField]` and then by each `linkFallback` entry, so `[[project.foo]]` and `[[Some Title]]` both resolve where unambiguous. Duplicate keys: the first by path wins; duplicates are listed in the vault settings.
- Parsing stays with `parseWikilink` / `extractWikilinks` (the rule in `.claude/CLAUDE.md`). Dotted ids need no parser change: `WIKILINK_PATTERN` accepts them; `#heading` and `|alias` still split first.
- Call sites to convert (from finding 5): the three `store.ts` functions; `graph-walk.ts` (`GraphData` gains an optional `linkKeyOf` so the module stays pure); both graph components; `MarkdownRenderer.svelte`; `SplitPane.svelte`; `NoteEmbed.svelte`; the note and read pages; `linkSuggest.ts`; `WikilinkAutocomplete.svelte` (inserts `[[<key>|<title>]]` when the key differs from the title, plain `[[title]]` otherwise). Link display: an unaliased `[[project.foo]]` shows the target's title, with the key in the hover preview (`LinkPreview.svelte`).

This conversion is worth doing as its own refactor (milestone 0) because it removes ten ad hoc copies of the same rule.

### 6.4 Search, tags, embeddings, Ask without a second copy

- **Search:** MiniSearch index is memory-only already; no change beyond 6.2.
- **Tags:** `getAllTags` / `getMemoryObjectsByTag` scan bodies for `#tags` today; for linked vaults they also count `MemoryObject.tags` (from `tagFields`), namespaced `type/…`, `status/…`.
- **Embeddings:** `runIndexing` and `semanticSearch` read `memoryObjects`, so they work. Vectors are cached in `kurumi-embeddings` by id with a content hash; add `deleteEmbeddingsWithPrefix('lf.<vaultId>.')` to `embeddings.ts` and call it on unlink. Removed files drop their vector when the `Remove` change is applied.
- **Ask:** `retrieveMemoryContext` works unchanged. Remote inference means note text from the linked folder is sent to the configured provider, exactly as for normal vaults; say so once when linking (one line in the dialog).
- **Agent pane and plugins:** read tools work. Write tools (`agent.ts` note creation, `plugins/host.ts` `addMemoryObject`) are refused in linked vaults until milestone 5, and then only when the vault is writable.

### 6.5 Frontmatter-preserving save

Save path for a linked note (`backend.saveNote(id, { title?, bodyMarkdown })`):

1. Ignore `title` unless it changed and `titleField` exists as a single-line scalar in the frontmatter (then `setScalarField`). Otherwise the title input is read-only for that note. Renaming files is out of scope.
2. Compute the new body with **minimal-diff write-back** (`write-back.ts`): the editor's first serialisation of the untouched note is kept as `normalizedBase`; on save, `mergeText(normalizedBase, originalBody, editedSerialisation)` from `src/lib/sync/text-merge.ts` yields the original bytes with only the user's changed lines replaced. If it returns `null` (overlap, or over `MAX_CELLS`), fall back to the editor's serialisation for the whole body. This keeps git diffs in the linked folder limited to what was actually edited. It needs a spike (risk 1).
3. If `updatedField` is configured and present as a scalar, set it to today (`YYYY-MM-DD`) or now (ISO), once per save, only when the body actually changed.
4. `content = joinNote(rawFrontmatter', body')`, preserving the file's newline style and trailing-newline state.
5. `linked_write(rel, baseHash, content)`. On success update `baseHash`, `mtime`, the in-memory note. On `ConflictError`, enter the conflict state (6.6).

Saves are queued per note (one in flight, latest wins), debounced by the existing 300 ms in the note page, and flushed on `pagehide` with a synchronous-enough path: the Rust call is fire-and-forget on unload, and `stashEdit` in `unsaved.ts` still records the text. `restoreStashedEdits` runs before the linked vault is mounted and only sees `allMemoryObjects` (document-only), so add a second pass after `openLinkedVault` that restores a stash for an `lf.` id only if the file hash still equals the hash stored with the stash; otherwise it raises the conflict prompt instead of writing.

### 6.6 External changes and conflicts

- External change to a note that is not open, or open without unsaved edits: the read model updates, `memoryObjects` re-emits, and the note page's existing effect ("Pick up body changes made elsewhere", lines 605–619) reloads the editor. No prompt.
- External change while the open note has unsaved edits, or `ConflictError` on save: try `mergeText(base, mine, theirs)` on the bodies. If it merges cleanly and the frontmatter did not change on both sides, write the merge (guarded by the new hash) and show a short notice ("Merged with a change made outside Kurumi"). Otherwise open the conflict dialog: reuse `GitConflictModal.svelte` (side by side, pick or combine) with choices *Keep mine*, *Take the file's version*, *Combine*. Until resolved, autosave for that note is paused and a banner says so. Nothing is written without a matching hash.
- File removed externally while open with edits: banner "This file was deleted outside Kurumi" with *Save as new file* (milestone 5) or *Discard*.

## 7. UI

- **Linking:** VaultSelector (`src/lib/components/VaultSelector.svelte`) create dialog gains a second choice, "Link a folder" (desktop app only). It calls `folder_pick`, then shows: name (defaults to folder name), detected conventions from a sample scan (share of files with frontmatter, most common candidate key fields such as `id`), link key, title field, ignore list (prefilled), respect `.gitignore`, read-only (on by default), "updated" field (off by default). Also a ⌘K command "Link a folder as a vault" in `CommandPalette.svelte`.
- **Guard rails when picking:** if the folder contains `kurumi-sync.bin` or `.kurumi/metadata.json`, refuse with "This is a Kurumi sync folder; use Settings → Sync → Local instead" (linking it would make two writers with opposite rules). If it is the currently configured Local sync folder, refuse likewise.
- **Editing the link:** the vault's edit dialog shows the full path (the desktop app knows it, unlike the browser), the settings above, note and skipped-file counts, duplicate link keys, watcher status, *Rescan*, *Reveal in file manager* **(assumed: via `tauri-plugin-opener`, which is installed; reveal support not verified)**, and *Unlink* (removes config and cached vectors; never touches files).
- **Badges:** a link glyph and "Linked folder" on the vault in the selector and the sidebar header; "Read-only" chip when applicable; the note header shows the relative path where normal notes show the folder breadcrumb.
- **Frontmatter display:** `NoteProperties.svelte` shows the parsed fields read-only ("Properties from the file"). The body editor never sees the frontmatter (so `frontmatterToCodeBlock` in `Editor.svelte` does not apply).
- **Read-only:** `Editor.svelte` gets a `readonly` prop (ProseMirror `editable: () => !readonly`); title input disabled; slash menu, block handle and file drop off.
- **What is hidden or disabled in a linked vault,** driven by `currentVaultCaps`:

| Area | Behaviour in a linked vault | How it is communicated |
|---|---|---|
| Notes: read, search (⌘K), quick switcher, tabs, split view, Read mode, backlinks, unlinked mentions, graph, tags page (browse), references (tags, links, `//dates`, `@mentions` found in text), Ask, agent pane (read tools), semantic search | Works | – |
| Editing bodies | Works when not read-only | Read-only chip otherwise |
| New note, daily note, templates, quick add, voice memo, meeting recording, web clipper, share target, imports | Off until milestone 5; then new note only | Buttons hidden; shortcuts show a notice: "New notes aren't available in a linked folder. Switch to a Kurumi vault to capture." |
| To-dos, projects, decisions, questions, meetings, proposals, drafts, people records, events, habits, flashcards, workflows, databases, canvases, favourites, page icons, version history, trash | Not available: they live in the Automerge document | Sidebar sections hidden; visiting the route directly shows one shared empty state: "This vault is a linked folder. To-dos and other records are kept in Kurumi vaults." with a vault switcher |
| Checkbox lines in notes | Rendered and clickable as plain Markdown edits; not promoted to to-dos | – |
| Tag rename/merge, people merge, topic merge, find-and-replace across notes | Off (bulk rewrites of foreign files) | Controls hidden |
| Moving, renaming, deleting notes and folders; drag and drop in the tree | Off | Tree menus omit them |
| Images and attachments | Relative image links render if the file is inside the root **(needs a read command for binary files; milestone 6)**; pasting files is off | – |
| Sync to other devices, Markdown/JSON export of this vault | Not applicable; sync continues for Kurumi vaults in the background | Settings → Sync shows: "Linked folders aren't synced by Kurumi. '<name>' is read from <path>." SyncFab unchanged |
| Digest, weekly review, living notes, note-task sync, due notifications | Keep running for Kurumi vaults only; never read or write linked notes | – |

- **Web/PWA:** the feature is absent. The create dialog shows "Linked folders need the desktop app" with the existing Settings → Desktop app link. Justification: File System Access exists only in Chromium, has no change notification (so "live" would be polling), re-asks permission after a restart (the "picker dance" requirement 6 rules out), cannot rename-over atomically or guard a write by hash, and hides the real path. A linked vault configured on the desktop never appears in the browser because its config is per device.

## 8. Relationship to the existing folder format and agent guide

- `src/lib/sync/agent-guide.md` describes Kurumi's **own** on-disk format for a sync folder and is written as `.kurumi/AGENTS.md` on every sync. A linked folder is the inverse case: the folder's conventions rule, and Kurumi writes none of `.kurumi/AGENTS.md`, `.claude/CLAUDE.md`, `metadata.json` or `kurumi-sync.bin`. No code in `src/lib/linked/` may import `local-fs.ts`, `claude-instructions.ts` or the guide; a unit test asserts this by scanning imports.
- Add two sentences to the guide's "Which setup is this?" section: a folder without `.kurumi/` that the user opens in Kurumi as a linked folder is not covered by this guide, and tools should follow that folder's own conventions. The existing unit test that runs the guide's JSON examples through the importer (`claude-instructions.test.ts` / `metadata-import.test.ts`) is unaffected.
- `src/lib/sync/metadata-import.ts` (`readMetadataRecords`, `pickExternalChanges`) is the supported way for outside tools to add to-dos, people and projects, and it requires a Kurumi sync folder. It is not used for linked vaults. For a user who wants both (records from files and foreign notes), the answer is two vaults: a Kurumi vault with Local sync, and the linked folder. Reused from that area: `hashText` in `folder-state.ts` for cheap change checks on the web side, and `mergeText`.
- `docs/` updates when shipped: a "Linked folders" section in `docs/sync.md` (contrasting it with Local folder sync), a row in the `desktop/README.md` "How it fills the gaps" table, a paragraph in `docs/architecture.md` (the document is no longer the only source of notes), and the Desktop section of `.claude/CLAUDE.md` (the document-only rule for `memoriesView()` / `getCurrentVaultId()`).

## 9. Milestones

Each milestone ships on its own and keeps `npm run check` at 0/0.

### M0 — Link resolver refactor (no behaviour change)
- **Files:** new `src/lib/linked/links.ts`; `src/lib/db/store.ts` (`findBacklinks`, `findMemoryObjectByTitle`, `findUnlinkedMentions`); `src/lib/graph-walk.ts`; `src/routes/graph/+page.svelte`; `src/lib/components/Graph.svelte`, `MarkdownRenderer.svelte`, `SplitPane.svelte`, `NoteEmbed.svelte`, `WikilinkAutocomplete.svelte`; `src/routes/memory/[id]/+page.svelte`; `src/routes/read/[id]/+page.svelte`; `src/lib/editor/linkSuggest.ts`.
- **Tests:** `src/lib/__tests__/link-resolver.test.ts` (title mode equals old behaviour; key mode with dotted ids, fallbacks, duplicates, aliases, headings); existing `wikilinks.test.ts`, `graph-walk.test.ts`, `link-suggestions.test.ts` stay green.
- **Done when:** no file outside `links.ts` compares `title.toLowerCase()` to a link target; e2e smoke unchanged.

### M1 — Read-only linked vault (first useful release)
- **Rust:** `linked.rs` with `linked_open` (scan only), `linked_read`, `linked_close`; `ignore` crate; `lib.rs` registration.
- **TS:** `src/lib/linked/{types,config,frontmatter,backend,capabilities}.ts`; store routing from 4.3 (read side and `setCurrentVault`); `docVaults` / `docCurrentVaultId` and the `sync/service.ts` switch; `Editor.svelte` `readonly`; VaultSelector "Link a folder" with a minimal form (name, link key, ignore list); badges; capability gating of sidebar and creation entry points in `+layout.svelte`, `CommandPalette.svelte`, `FolderTree.svelte`; shared empty state for record routes; manual *Rescan*.
- **Tests:** vitest `linked-frontmatter.test.ts` (split/join round-trips byte-for-byte across LF, CRLF, BOM, no frontmatter, `---` inside body, empty body), `linked-backend.test.ts` (fake `invoke` in the style of `desktop-folder.test.ts`: notes, folders, ids, tags from fields), `linked-isolation.test.ts` (with a linked vault active: `getDocBinary()` and `exportFullJSON()` contain no `lf.` id; `getVaultContents` and the sync mirror list exclude it; `reconcileNoteTasks` creates nothing; `doc.currentVaultId` unchanged); `cargo test` for scan and ignore; `selftest.js` phase 1 links `<dir>/folder` with two fixture notes and checks they are listed, phase 2 checks the vault is back after restart with no dialog.
- **Done when:** a folder with foreign frontmatter opens in the desktop app; search, backlinks by `id`, graph, tags and Ask work; `git status` in the folder is clean after browsing every note; the linked vault is still there after restart; the web build shows the "needs the desktop app" text.

### M2 — Live updates
- **Rust:** watcher (`notify`, `notify-debouncer-full`), change log, `linked_changes`, rescan fallback, burst handling.
- **TS:** long-poll loop in `backend.ts`, incremental resolver and index updates, watcher status in vault settings.
- **Tests:** `cargo test` for create/modify/remove/rename and ignored paths; vitest for applying `Change`s and `rescan`; `selftest.js` writes a file through `fs_write` into the linked folder and waits for it to appear in the page.
- **Done when:** a file edited, added or removed outside appears in the open app within about a second, including after a simulated `git checkout` of 1,000 files (one rescan, no UI freeze).

### M3 — Editing with byte-preserving frontmatter and conflict detection
- **Rust:** `linked_write`, shared `atomic_write`, self-write suppression, read-only enforcement.
- **TS:** `write-back.ts`; save queue in `backend.ts`; `updateMemoryObject` routing; `unsaved.ts` second pass; conflict state, banner and dialog (reusing `GitConflictModal.svelte`); read-only toggle in vault settings.
- **Tests:** vitest `linked-write-back.test.ts` (one changed line changes one line of the original bytes; fallback path; frontmatter untouched for a fixture using `id`, `type`, `scope`, `title`, `summary`, `status`, `source`, `updated`, `paths` as a list); conflict flow against the fake backend; `cargo test` for stale hash, permissions kept, no temp file left; `selftest.js` edits through the real commands and checks the file bytes.
- **Done when:** typing in a note changes only the edited lines in `git diff`; frontmatter bytes are identical; an external change to the same file between load and save produces the prompt, never an overwrite.

### M4 — Conventions: title, "updated" field, full settings
- **Files:** `frontmatter.ts` `setScalarField`; vault settings form (title field, summary field, tag fields, updated field and format, respect `.gitignore`); convention detection on link; duplicate-key report.
- **Tests:** scalar edit touches exactly one line, refuses multi-line or quoted-with-escape values, keeps quoting style; updated field written once per changed save.
- **Done when:** with `updatedField: 'updated'`, an edit changes the body lines and that one frontmatter line only.

### M5 — Creating notes (optional, product decision needed)
- **Rust:** `linked_create`. **TS:** per-vault "new note" settings (target directory, filename pattern, frontmatter template with `{title}`, `{date}`, `{id}` placeholders), `addMemoryObject` routing, "create from unresolved link".
- **Tests:** create refuses existing files and ignored paths; template rendering.
- **Done when:** ⌘N in a writable linked vault produces a file the external tool accepts (validated against the motivating folder's conventions by its owner).

### M6 — Polish
- Relative images and attachments (a binary `linked_read_bytes` with size cap); reveal in file manager; nested roots (see open question 3); screenshots and docs.

## 10. Risks

1. **Editor round-trip changes text the user did not touch.** Milkdown re-serialises the whole body; the plan depends on minimal-diff write-back (6.5) behaving well on real notes (tables, nested lists, escaped characters, wikilinks in tables). Spike this first inside M3 with a corpus from the motivating folder; if it is not good enough, M3 ships with a plain-text source editor for linked notes instead.
2. **Two writers.** Hash-guarded writes close the overwrite hole except for a few milliseconds between check and rename. A nightly job that rewrites many files while a note is open will raise prompts; auto-merge of non-overlapping lines keeps that rare.
3. **Leaks into the document or sync.** Mitigated by keeping `memoriesView()` and `getCurrentVaultId()` document-only and by `linked-isolation.test.ts`. Any future store function that should see linked notes must opt in; note this rule in `.claude/CLAUDE.md`.
4. **Path-based ids.** Renaming or moving a file outside Kurumi gives the note a new id; recents, pinned tabs, fold state (`kurumi-folds:<id>`) and its cached vector are lost for that note. Acceptable for a first version; an id based on the link key is possible later where keys are unique.
5. **Large folders.** The scan sends every file's text over IPC at open (10,000 notes of 4 KB is about 40 MB of JSON). If that is too slow, page the scan or send bodies lazily; the plan keeps full text in memory because search, backlinks and embeddings need it.
6. **Watcher limits.** inotify watch limits on Linux, network shares, and cloud-synced folders with placeholder files; hence the rescan fallback.
7. **Windows.** Long paths, case-insensitive names and `\\?\` prefixes are already handled in `Folders::authorize`; `rel` normalisation to `/` needs its own tests.
8. **`currentVaultId` consumers.** Nine files read it; any that pass it to a document writer will now receive a linked id. The audit in M1 covers `src/lib/sync/service.ts` explicitly; the others are read-only uses **(assumed from grep; confirm each during M1)**.
9. **Crate versions and Tauri long-poll behaviour** were not verified offline (a 25 s pending async command per vault should be fine on Tauri's runtime, but confirm it does not block app exit).

## 11. Open questions for the product owner

1. **Capture while in a linked vault.** Should ⌘N, quick add and voice memos be blocked with a notice (this plan), or silently go to the last Kurumi vault? The store already makes the second option safe.
2. **Derived data on disk.** Are embedding vectors for linked notes in IndexedDB acceptable under "no divergent copy"? If not, vectors can be memory-only at the cost of re-embedding after every start.
3. **Nested repositories.** When the linked folder contains separate repositories in subdirectories: one vault for the whole tree (this plan; links resolve across them), or one vault per subdirectory with the parent excluding them? Should a frontmatter field that names the sub-collection become a filter or tag?
4. **Read-only by default?** The plan defaults to read-only and makes editing an explicit choice per vault.
5. **Link key fallbacks.** Should `[[Title]]` resolve in a vault keyed by `id` (this plan: yes, when unambiguous), or should only the key resolve, to match the external tool exactly?
6. **The hidden temp file** created beside a note for a few milliseconds during an atomic write: acceptable, or must even that stay outside the folder?
7. **Remote AI.** Linked folders may hold material the user treats as more private than their notes. Should Ask and the agent default to local inference only in linked vaults, with remote as an opt-in per vault?
8. **Checkbox lines.** Never promoted to to-dos in linked vaults (this plan), or promoted into a chosen Kurumi vault with a link back?
9. **Several linked vaults.** Only the active one is mounted. Is cross-vault search over unmounted linked vaults wanted?
10. **Mobile.** The Tauri crate also builds for iOS and Android, where the folder dialog is unavailable (`pick_folder` under `#[cfg(mobile)]`); the plan leaves linked vaults off there.

### Critical Files for Implementation
- src/lib/db/store.ts
- desktop/src-tauri/src/folders.rs
- src/lib/sync/service.ts
- src/routes/memory/[id]/+page.svelte
- src/lib/wikilinks.ts

Other files read and referenced: `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/capabilities/default.json`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/src/selftest.js`, `src/lib/desktop/folder-handle.ts`, `src/lib/git/convert.ts`, `src/lib/utils/frontmatter.ts`, `src/lib/sync/local-fs.ts`, `src/lib/sync/text-merge.ts`, `src/lib/sync/folder-state.ts`, `src/lib/sync/agent-guide.md`, `src/lib/sync/metadata-import.ts`, `src/lib/sync/claude-instructions.ts`, `src/lib/embeddings.ts`, `src/lib/search/index.ts`, `src/lib/ask.ts`, `src/lib/graph-walk.ts`, `src/lib/unsaved.ts`, `src/lib/components/Editor.svelte`, `src/lib/components/VaultSelector.svelte`, `src/routes/+layout.svelte`, `src/lib/__tests__/desktop-folder.test.ts`, `.claude/plans/next-phase-roadmap.md`.
