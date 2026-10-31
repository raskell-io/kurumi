# Kurumi (クルミ)

*Walnut in Japanese — because it looks like a brain.*

A local-first, browser-based **personal memory assistant**. Kurumi
started as a notes PWA and has grown into a durable second brain that
captures typed notes, voice memos, meetings, and structured knowledge,
then helps you recall and act on them. Works offline, syncs via your
own git repo, and routes inference between on-device models and remote
APIs.

## Vision

Kurumi is meant to be the fastest place to offload a thought, and the
best place to recall one later. Everything it does is in service of
that loop:

- **Capture first** — typed notes, voice memos, meetings, file uploads.
- **Process quietly** — transcribe, summarize, extract entities,
  propose reminders and drafts.
- **Surface at the right time** — dashboards, daily notes, due-today
  lists, proposals for review, browser notifications.
- **Your data, your control** — everything stored locally in
  IndexedDB, synced through your own git remote, exportable as plain
  markdown at any time.

## Core principles

1. **Capture first, chat second.** Friction to save a thought should
   be near zero.
2. **Local-first, not local-only.** Everything works offline; remote
   is the fallback.
3. **Human-in-the-loop by default.** The assistant proposes, the user
   approves.
4. **Graph-native memory model, tree-assisted navigation.** Folders
   for browsing, links + entities for truth.
5. **Policy-routed inference.** Tasks pick local vs. remote based on
   capability and user preference, not hardcoded.
6. **Plain text at heart.** Markdown bodies, YAML frontmatter,
   exportable. No vendor lock-in.

## Tech stack

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | SvelteKit 2 + Svelte 5 runes | Small bundles, excellent DX |
| Styling | Tailwind CSS 4 + CSS variables | Utility-first + themeable |
| Data | Automerge CRDTs | Conflict-free local storage |
| Storage | IndexedDB (idb-keyval + raw IDB for blobs) | Fast local persistence |
| Editor | Milkdown | Markdown WYSIWYG |
| Search | MiniSearch (keyword) + local embeddings (semantic) | Hybrid recall |
| Graph | force-graph | WebGL connection viz |
| PWA | @vite-pwa/sveltekit | Offline + installable |
| Sync | isomorphic-git → GitHub / Codeberg / GitLab | User-owned remote |
| Local inference | transformers.js (Whisper, SmolLM2, Qwen, Llama 3.2, MMS TTS, all-MiniLM-L6 / multilingual-e5-small) | On-device ML |
| Remote inference | OpenAI (transcribe, chat, TTS) | High-quality fallback |
| Deploy | Cloudflare Pages / GitHub Pages | Static host |

## Architecture

```
┌────────────────────────────────────────────┐
│               Kurumi UI                    │
│       (SvelteKit + Svelte 5 runes)         │
├────────────────────────────────────────────┤
│             $lib/stores                    │
│   memory · inference router · undo ·       │
│   notifications · snackbar · ask           │
├────────────────────────────────────────────┤
│         Automerge Document (v17)           │
│  memoryObjects · folders · vaults ·        │
│  people · events · templates ·             │
│  actionItems · reminderProposals ·         │
│  draftProposals · projects · decisions ·   │
│  questions · meetingSeries · …             │
├────────────────────────────────────────────┤
│   IndexedDB (doc binary + blob store +     │
│   embeddings cache + model cache)          │
├────────────────────────────────────────────┤
│   Git sync via isomorphic-git (markdown    │
│   round-trip + .kurumi/metadata.json)      │
└────────────────────────────────────────────┘
```

## Data model

Everything lives on one Automerge document. The current schema version
is **17** (incremented by migrations in `src/lib/db/store.ts`).

Persistence (`saveDoc` in `store.ts`): a full snapshot under
`kurumi-doc` plus incremental change chunks under `kurumi-doc-changes`
(`Automerge.saveSince` against explicitly tracked heads; never
`saveIncremental`, which sync's `Automerge.save` calls would reset).
Saves are coalesced; chunks fold into a snapshot when idle or past 200.
A doc that doesn't descend from the persisted heads (restore, adopt
remote, reset) always gets a fresh snapshot, so old data can't merge
back in on load. Unreadable stored data is kept under
`kurumi-doc-unreadable-*` instead of being overwritten.
Loaded chunks are compacted 3s after start too (`scheduleCompaction`),
not only after an edit, so capture-and-close use doesn't pile them up.

**Writing note text:** always through `setMemoryText(d, id, field,
value)` (Automerge `updateText`, a diff), never `memory.bodyMarkdown =
…`. Strings are collaborative text in Automerge 3; assigning one stores
a full new copy, so with autosave the history (and load time) grew with
every pause in typing. The e2e scenario "autosaves store the edit, not a
copy of the note" guards this (~1.5 MB vs ~50 KB for 300 saves).

**Bulk changes** (imports, generated vaults): wrap them in
`batchUpdates(() => …)`: one store refresh and one save instead of one
per item. Code inside reads the document directly; derived stores
update at the end.

**Optimized vaults (Phase 2):** Settings → Offline & storage → Optimize
vault (`optimizeVault`) rebuilds the document as a fresh history
(`doc.epoch`) with long text fields (`bodyMarkdown`, `transcript`,
`summaryLong`, `rawText`) as Automerge `ImmutableString`s
(`doc.textFormat = 'plain'`, `doc.minAppVersion = PLAIN_FORMAT_SINCE`).
Measured at 10k notes: database load 11.9 s → 0.9 s. The old database is
kept under `kurumi-doc-before-optimize` (`undoOptimizeVault`, which keeps
edits made since). Rules for code in `store.ts`:
- Read memories outside change callbacks through `memoriesView()` /
  `memoriesOf(doc)` (plain JS strings, cached per memory object), never
  `doc.memoryObjects` directly: ImmutableStrings come back as objects.
- Inside change callbacks wrap text before string methods:
  `plainText(memory.bodyMarkdown)`.
- Write memories with `toStored(memory, d)`, text fields with
  `setMemoryText` / `storedText(d, …)`.
- Other modules only see memories through store exports, which are
  already plain.
Sync across histories (`mergeDoc`): same epoch → CRDT merge; different →
the newer epoch wins and the other side's records are merged in by
`mergeRecords` (every collection, union by id, newest timestamp wins).
`mergeRecords` is also the fallback when a CRDT merge of unrelated copies
loses records (it replaced `manualMerge`, which missed 8 collections). A
document with `minAppVersion` newer than this app is refused
(`NewerVaultError`; on load the layout asks to reload). The local agent
needs no change: its merge driver already refuses unrelated histories and
parks them for `mergeDoc`.
Text format load cost: ~0.65 s per million characters; plain: a fraction.

**MemoryObject** is the unified capture shape — text notes, voice
memos, meetings, files, references all use it, distinguished by `type`.
Key fields: `id`, `type`, `title`, `bodyMarkdown`, `rawAudioRef`,
`transcript`, `summaryShort`, `summaryLong`, `tags`, `participants`,
`projects`, `topics`, `actionItems`, `meetingExtras`, `folderId`,
`createdAt`, `updatedAt`, `deletedAt`, `vaultId`.

**Top-level collections** on `KurumiDocument`:

- `memoryObjects` — all captures
- `folders` — nested navigation tree
- `vaults` — multi-vault support
- `people` — first-class @mention entities with merge workflow
- `events` — `//YYYY-MM-DD` references
- `templates` — parameterized note templates
- `actionItems` — shown as **To-dos** everywhere in the UI (code keeps `ActionItem`, the route stays `/actions`). Promoted from meeting drafts or manually created; have status (open/in_progress/done/cancelled) and dueDate
- `reminderProposals` — time-anchored nudges extracted from memories, awaiting user review (pending/approved/rejected/snoozed); approval creates an ActionItem
- `draftProposals` — email and calendar-event drafts extracted from memories (pending/used/rejected), user copies them into their real client
- `projects` — first-class projects (status, owner, due, description). Notes link by **name** (`MemoryObject.projects`, also filled by extraction); action items by `projectId` or via their source note; decisions/questions by `projectId` or source note (`recordInProject`). Note project names that aren't projects are only *suggested* on /projects
- `decisions` — decision log; meeting summaries' `decisions` are promoted automatically (`promoteMeetingRecords`)
- `questions` — open questions (open/answered/dropped); meetings' `unresolvedQuestions` are promoted automatically
- `meetingSeries` — recurring meetings with a running agenda; `startSeriesMeeting` creates a note (`seriesId`) from the open agenda + open to-dos/questions for its people/project

"Waiting for" (`src/lib/work.ts`): open action items assigned to someone
other than you (your names: Settings → Profile, per device).

## Capture pipeline

1. User creates a memory (type note / voice-memo / meeting)
2. For audio memories: `transcribeMemoryAudio` runs
   - **transcribe** (Whisper local first, OpenAI fallback)
   - Parallel: **summarize** / **generateTitle** / **extractEntities**
     / **summarizeMeeting** / **proposeReminders** / **proposeDrafts**
3. Results stashed: summary/title on the memory, extracted entities
   merged into `participants`/`projects`/`topics`, action item drafts
   promoted to persistent `ActionItem` entities, reminder + draft
   proposals added to their respective queues for user review.
4. Embedding refreshed so semantic search picks up the new content.

For plain text notes, the Bell button on the memory detail page runs
the reminder + draft extraction manually.

## Inference layer

`src/lib/inference/` holds the provider abstraction. Providers
implement a shared interface (`summarize`, `summarizeMeeting`,
`transcribe`, `extractEntities`, `proposeReminders`, `proposeDrafts`,
`tts`, `answerWithContext`, ...) and advertise capabilities via
`ProviderCapabilities`.

Registered providers in order:
1. `WhisperLocalProvider` — transcribe via transformers.js Whisper
2. `TextLocalProvider` — text generation via SmolLM2 / Qwen / Llama
3. `OpenAIProvider` — remote fallback: transcribe, chat, TTS, JSON-mode
   extraction (reminders, drafts, meetings)
4. `TtsLocalProvider` — on-device TTS via MMS, registered AFTER
   OpenAI so remote TTS (higher quality) wins when available

The router picks the first provider whose capabilities match the task;
`voice.ts` speak() iterates providers so TTS gracefully falls back from
OpenAI to MMS when the API key is missing.

## Key features

### Capture
- Typed notes (Milkdown editor, auto-save, wikilinks, tags, @people,
  `//YYYY-MM-DD` events, templates)
- Editor extras (`src/lib/editor/`): block handle with drag + Turn
  into / Duplicate / Delete (`blockHandle.ts`, `blocks.ts`; slash
  commands build real nodes through `blocks.ts` too), find & replace
  incl. across notes (`findReplace.ts`, `FindBar.svelte`), live
  `![[embeds]]` (`noteEmbed.ts`), paste a URL onto selected text to
  link it (`pasteLink.ts`), clickable GFM task checkboxes
  (`taskToggle.ts`), mobile formatting toolbar (`MobileToolbar.svelte`)
- Editor plugins register their UI callbacks per editor container
  (`editor/registry.ts`), so two editors can be open at once
- Split view: a second note beside the main one (`SplitPane.svelte`,
  `splitNoteId` in `stores/workspace.ts`); Alt+click a tree row or
  `[[link]]`. Both panes reload when a note changes elsewhere, unless
  the user is mid-edit
- Files: pasting or dropping a file (`editor/fileDrop.ts`) inserts
  images inline, audio as a player (`![audio:…](blob:…)`), anything else
  as an attachment link `[name.pdf](blob:<id>)` (`src/lib/attachments.ts`)
  that renders as a chip and opens in a tab or downloads. Typing at a
  chip's edge stays plain text. Blob sync carries attachments like images
- Voice memos with pause/resume, waveform, mic + tab audio
- Meeting mode: long-form recording with structured summary
- Upload existing audio/video for transcription
- Daily notes (`/daily`, `Cmd+D`) — auto-create from Daily Journal
  template, anchored to the requested ISO date

### Recall & Navigation
- Full-text search via MiniSearch (`Cmd+K`)
- Semantic search via local embeddings (MiniLM or multilingual-e5)
- Ask Kurumi (`/`) — hybrid keyword + semantic retrieval with inline
  `[n]` citations, multi-turn conversation, voice mode
- Person page (`/people/{name}`) — contact profile (edit, vCard),
  waiting-for, open questions, recurring meetings and mentioning notes.
  @mentions, References → People and the People list all open it
- References (`/references`) — tags, people, links, and a dates agenda
  of `//dates`, events, open to-dos by due date and the next expected
  date of each recurring meeting
- Read mode (`/read`) — blog-style browsing with folder / tag / date
  / person / topic filter routes
- Graph view (`/graph`) — force-directed memory link visualization
- Weekly review (`/review`) — stats, AI summary, overdue + pending
- Folder tree with unlimited nesting, drag-drop, swipe-delete
- Quick switcher (`Cmd+O` / `Cmd+P`, or `Cmd+K` with an empty query) —
  notes recently opened on this device first (`recentNoteIds` in
  `stores/workspace.ts`), excluding the current note
- Favorites — `favoritedAt` on the memory (synced, doesn't bump
  `updatedAt`); sidebar section, header star, tree row menu
- Page icons — `icon` on the memory (emoji, or uploaded image as a data
  URL); `IconPicker` / `NoteIcon` components; shown in tree, tabs,
  favorites, switcher, breadcrumb and `[[link]]` hover preview. Emoji
  icons round-trip through git frontmatter (`icon:`), images don't

### Process & Act (Phase 9 controlled action layer)
- **To-dos** (`/actions`, `Cmd+Shift+A`) — promoted from meeting
  drafts or manually created. Inline edit, bulk select, mark done /
  in_progress / cancelled / delete. Due-today list on home page.
- **Reminder proposals** (`/proposals`) — time-anchored follow-ups
  extracted from memories. Approve → creates ActionItem with dueDate.
  Reject / snooze / reopen / delete. Audit log semantics.
- **Draft proposals** (`/drafts`) — email + calendar-event drafts
  extracted from memories. Copy-to-clipboard; no email/calendar API
  integration by design.
- **Browser notifications** — optional; fires for due to-dos every 60s
  while the app is open (with Mark done / Snooze 1h buttons through the
  service worker). Clicking jumps to `/actions`.

### Ontology maintenance (roadmap §6.6)
- **People merge** (`/people`) — detect duplicates, merge rewrites
  `@mentions` across all memory bodies + participant lists + action
  item assignees.
- **Tag normalization** (`/tags`) — merge dupes, rename, flag
  low-value tags (used once).
- **Topic / project merge** (`/topics`) — same dedupe workflow for the
  bare-string entity types.

### Sync
- Local folder sync (`src/lib/sync/local-fs.ts`): writes `kurumi-sync.bin`
  plus a markdown mirror of the current vault, or with "Write all vaults"
  one self-contained subfolder per vault (`.kurumi/vaults.json` maps vault
  id → folder; renamed/removed vaults' folders are pruned).
  Reading back (`syncLocalFS` in `sync/service.ts`): body/tag edits of
  known notes (by frontmatter id), and new `.md` files / directories
  added from outside (`importNewLocalFiles`): files become notes, dirs
  folders (matched by name or slug), new top-level dirs vaults in the
  all-vaults layout. After the mirror is written, imported originals are
  removed if their canonical path is a different file (exact-name check;
  case-insensitive disks make `A.md`/`a.md` one file).
- Pasting (`editor/pasteMarkdown.ts`): structured HTML (chat output, web,
  Google Docs) → cleaned → markdown via hast-util-to-mdast → editor
  parser; unstructured HTML (editors) uses the text/plain markdown; VS
  Code code (non-markdown) stays a Milkdown code block.
- Local git agent (`agent/kurumi-agent.mjs`, plain Node, run outside the
  browser): commits that folder and pulls/pushes with the system git. A
  git merge driver CRDT-merges `kurumi-sync.bin`; regenerated files keep
  the local side. Databases with unrelated history are parked as
  `kurumi-sync.incoming-*.bin`, which the app merges via `mergeDoc` and
  deletes.
- Kurumi sync server (`worker/`, method id `r2`, shown as "Kurumi
  server"): Cloudflare Worker + R2. `GET /` is a setup page; `POST
  /claim` works once (token stored as a SHA-256 hash under
  `kurumi-config/`, out of reach of `?key=`); `SYNC_TOKEN` secret still
  accepted. Deploy button: `deploy.workers.cloudflare.com/?url=…/tree/main/worker`.
  Pairing links (`src/lib/sync/pairing.ts`): `/#/settings/sync?pair=<base64url {url, token}>`,
  applied then removed from the address bar; "Add a device" makes one.
  Worker tests: `worker/src/index.test.ts` (run by `npm test`); the e2e
  scenario runs the real worker in Node behind an in-memory bucket
- End-to-end encryption (`src/lib/sync/crypto.ts`), optional: R2/S3/
  WebDAV/Azure documents and blobs are sealed ("KRMENC01" | salt | iv |
  AES-256-GCM, PBKDF2-SHA-256 600k). On/off is `doc.syncEncrypted` (synced,
  so every device follows it; a per-device flag made devices re-seal each
  other's readable uploads); keys stay per device in IndexedDB. Not per
  vault: the sync file holds all vaults. Turning on derives a fresh salt
  and key (so a new passphrase really replaces the old); devices converge
  on the salt of the copy they open. A typed passphrase is tried first and
  its key stored only once it opens the copy (a typo can't lock a device
  out); a stored key for that salt is the fallback. Turning off keeps keys
  so the sealed copy can still be read once. Git and the local folder (the
  agent merges its binary) are never sealed
- Git sync: clones to IndexedDB, writes memories as markdown files +
  `.kurumi/metadata.json`, pulls/pushes via isomorphic-git through a
  CORS proxy, detects real conflicts (both sides changed since last
  sync with non-whitespace-equivalent content) and shows a
  side-by-side resolution modal.

### Voice assistant
- Push-to-talk via `Cmd+Shift+V` from anywhere
- Microphone → transcribe → ask → TTS playback
- Voice toggle on home page for hands-free mode
- Inline speak button on every answer

### Templates
- Parameterized markdown templates with `{title}`, `{date}`,
  `{weekday}`, etc.
- Starter templates seeded on first run (Meeting Notes, Daily
  Journal, Project Brief)
- `/templates` management page

### Export / Import
- Markdown export in three formats (vanilla, Hugo, Zola) with
  full front matter, transcripts, summaries, action items, open
  questions. Images, recordings and attachments go into `<vault>/assets/`
  in the ZIP, linked relatively (`collectAssets` / `linkAssets`)
- Notion import (`utils/notion-import.ts`): the "Markdown & CSV" ZIP
  (ZIPs inside are opened); ids stripped, page tree → folders, page links
  → [[wikilinks]] (no aliases: Kurumi has no `[[a|b]]`), files stored as
  blob refs, CSV tables skipped (rows come as pages)
- Example vault (`src/lib/example-vault.ts`): welcome screen "explore an
  example" or ⌘K "Explore example vault"; a separate vault named
  `Example` with a project, meeting series, to-dos, decisions, questions
  and people, dated relative to today
- Single-memory download from memory detail page
- All-vaults ZIP export (one top-level folder per vault, named by
  `vaultDirNames` in `markdown-export.ts`, shared with the folder mirror)
- Obsidian vault import
- Full JSON backup / restore

### Organization
- Work section: Projects (/projects, /projects/[id]), Meetings
  (/meetings, /meetings/[id]), Decisions (/decisions), Questions
  (/questions). Notes link to projects via chips under the title; the
  note ⋯ menu logs decisions/questions and adds agenda items
  (`NoteRecordDialog`). Person pages show what's waiting on them
- To-dos: Active / Waiting for / Completed tabs; list or Kanban board (Open / In progress / Done, drag
  or arrows), filters by project (from the source note) and assignee
- Labs (`stores/labs.ts`, Settings → Labs, off by default): Habits,
  Flashcards, Timeline, Smart folders. Canvas and database views stay
  unlinked until they get real data-model support

### Offline (PWA)
- `UpdateToast.svelte` registers the Workbox service worker (production
  builds only; `registerType: 'prompt'`), so new versions wait for the
  user to click Reload instead of reloading mid-edit
- The app shell and assets are precached. The ONNX runtime (jsdelivr)
  is cached CacheFirst and model weights sit in transformers.js's own
  cache, so local AI works offline after one online run (Settings →
  Local AI → Download all)
- `static/sw-notify.js` (imported into the generated worker) handles the
  share target POST (`/share-target` → stashed → `/?share=incoming`),
  notification Mark done / Snooze 1h, periodic due checks and the icon
  badge. It shares the `kurumi-sw` IndexedDB (`shared`, `pending`,
  `snoozed`) with `src/lib/pwa.ts`; keep store names in step
- `src/lib/pwa-boot.ts` (after DB init): asks for persistent storage,
  keeps the badge (your due/overdue to-dos), applies queued notification
  actions, and imports `.md` files opened with Kurumi (`launchQueue`)
- `src/lib/incoming.ts` turns shares and opened files into notes
  (recordings → transcribed memos, images inline, markdown parsed, other
  files as attachments)
- Manifest: share target with files, app icon shortcuts (`/?new=note`,
  `/?new=voice`, `/#/daily`, `/#/actions`), `.md` file handler, and
  `launch_handler: navigate-existing` so launches reuse the open window.
  Not focus-existing: that may never perform a share's POST. The window
  reloads, so editors save on `pagehide`; that IndexedDB write can be cut
  off by the unload, so the text is also stashed in localStorage
  (`src/lib/unsaved.ts`) and applied at the next start if missing
- `stores/notice.ts` + `NoticeToast.svelte`: one short app-wide message
  (`showNotice`), e.g. an attachment not synced to this device yet
- Settings → Offline & storage says what this browser can't do as an
  installed app (iOS: no share target, file handling or background checks)
- Sync skips network methods while offline and runs on `online`;
  SyncFab shows "Offline". Settings → Offline & storage shows status,
  space used, version (`__KURUMI_VERSION__`), and resets the offline copy

### Performance notes
- Embeddings run in a Web Worker (`inference/embed.worker.ts`, wired
  through `loadPipeline('embed')`); vectors are cached in memory and
  searches don't wait for a big re-index
- The MiniSearch index updates incrementally (`syncIndex`)
- The tree renders 200 notes per folder level with "Show more"

### Undo (global)
- 30-entry, 5-minute in-memory undo stack
- `Cmd+Z` from anywhere pops the last destructive action
- Toast shows the latest entry for 6s with an Undo button
- Wired into: action item delete + status change + bulk actions,
  reminder proposal reject/delete + bulk, draft proposal
  reject/delete + bulk

## Project structure

```
src/
├── lib/
│   ├── ai/                  # Legacy AI config (OpenAI key, model choice)
│   ├── ask.ts               # Ask Kurumi orchestration (hybrid retrieval)
│   ├── components/          # Svelte components
│   │   ├── Editor.svelte
│   │   ├── FolderTree.svelte
│   │   ├── CommandPalette.svelte
│   │   ├── GitConflictModal.svelte
│   │   ├── UndoToast.svelte
│   │   ├── VoiceRecorder.svelte
│   │   └── ...
│   ├── db/                  # Automerge + IndexedDB + migrations + CRUD
│   │   ├── types.ts         # All entity types + KurumiDocument
│   │   ├── store.ts         # Derived stores, CRUD, pipeline, migrations
│   │   ├── blob-store.ts    # Raw blob storage for audio/media
│   │   └── index.ts
│   ├── embeddings.ts        # Semantic search via transformers.js
│   ├── git/                 # isomorphic-git sync service
│   │   ├── service.ts       # syncGit, conflict detection, push/pull
│   │   ├── convert.ts       # Memory ↔ markdown file conversion
│   │   ├── fs.ts            # LightningFS wrapper
│   │   └── status.ts        # Sync state store
│   ├── inference/           # Provider abstraction + router
│   │   ├── types.ts         # InferenceProvider interface + task types
│   │   ├── router.ts        # SimpleInferenceRouter
│   │   ├── local-models.ts  # transformers.js pipeline cache
│   │   ├── settings.ts      # Local model selection persistence
│   │   └── providers/       # WhisperLocal, TextLocal, TtsLocal, OpenAI
│   ├── notifications.ts     # Browser notification loop for due actions
│   ├── search/              # MiniSearch keyword index
│   ├── stores/
│   │   ├── snackbar.ts      # Cross-component UI signals
│   │   └── undo.ts          # Global undo stack
│   ├── sync/                # Sync orchestration (delegates to git or R2)
│   ├── utils/               # markdown-export, obsidian-import
│   └── voice.ts             # Push-to-talk + TTS with provider fallback
├── routes/
│   ├── +layout.svelte       # Sidebar, keyboard shortcuts, boot
│   ├── +page.svelte         # Home / Ask Kurumi + due-today strip
│   ├── actions/             # To-dos (ActionItem) list + board
│   ├── daily/[date]/        # Daily notes
│   ├── drafts/              # Email/calendar draft review
│   ├── graph/               # Graph view
│   ├── memory/[id]/         # Memory detail + editor
│   ├── people/              # People management + merge; [name]/ person page
│   ├── proposals/           # Reminder proposals review
│   ├── read/                # Blog-style reader with filters
│   ├── references/          # Tags / people / dates (+ due to-dos, meetings) / links
│   ├── review/              # Weekly review
│   ├── settings/[[section]]/ # One page per settings section (/settings/sync, …)
│   ├── tags/                # Tag normalization
│   ├── templates/           # Template management
│   ├── topics/              # Topic + project merge
│   └── trash/               # Soft-deleted memory restore
└── app.css                  # Theme variables
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Command palette / search |
| `Cmd/Ctrl + O` / `P` | Quick switcher (recent notes first) |
| `Cmd/Ctrl + N` | New note |
| `Cmd/Ctrl + D` | Today's daily note |
| `Cmd/Ctrl + G` | Graph view |
| `Cmd/Ctrl + R` | References |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + Z` | Undo last destructive action |
| `Cmd/Ctrl + Shift + R` | Read mode |
| `Cmd/Ctrl + Shift + A` | To-dos |
| `Cmd/Ctrl + Shift + V` | Voice assistant push-to-talk |
| `Cmd/Ctrl + Shift + I` | Inbox |
| `Cmd/Ctrl + Shift + C` | Calendar |
| `Cmd/Ctrl + Shift + F` | Toggle focus mode |
| `Cmd/Ctrl + \` | Collapse / expand sidebar |
| `Cmd/Ctrl + `` ` | Toggle agent pane |
| `Cmd/Ctrl + F` | Find in note |
| `Cmd/Ctrl + Option/Alt + F` | Find and replace |
| `Escape` | Close menu/modal/sidebar |

`Cmd/Ctrl + K`, `O`, `P`, `N`, `F` and `\` also fire while typing in an input or the editor.

App shortcuts are defined in `src/lib/shortcuts.ts` and can be rebound
per device in Settings → Keyboard shortcuts.

On list pages (`/actions`, `/proposals`, `/drafts`):

| Shortcut | Action |
|----------|--------|
| `j` / `↓` | Next item |
| `k` / `↑` | Previous item |
| `Space` | Toggle selection (bulk) |
| `Enter` | Open source memory |
| `d` / `Delete` | Delete |
| `x` | Mark done (actions) |
| `e` | Edit (actions) |
| `a` | Approve (proposals) |
| `r` | Reject (proposals, drafts) |
| `s` | Snooze (proposals) |
| `c` | Copy (drafts) |
| `Escape` | Clear selection / unfocus |

## Development

```bash
npm install
npm run dev          # dev server
npm run build        # production build
npm run preview      # preview built app
npx svelte-check     # type + a11y + css check (should be 0/0)
npm test             # unit tests (Vitest)
npm run test:e2e     # browser smoke tests (e2e/smoke.mjs; starts vite dev,
                     # headless Chrome; set CHROME_PATH if needed)
npm run test:pwa     # production build + service worker checks (e2e/pwa.mjs)
npm run screenshots  # production build + docs/images/*.webp from the example
                     # vault (e2e/screenshots.mjs; THEME=dark for *-dark.webp)
```

**Docs:** README.md is the short overview; user and developer guides
live in `docs/` (index: `docs/README.md`). A user-visible change updates
the guide that covers it; a changed screen means re-running
`npm run screenshots` (and `THEME=dark npm run screenshots`). Images are
embedded with `<picture>` (light + dark). `static/llms.txt` links the
main guides.

CI (`.github/workflows/ci.yml`) runs svelte-check, unit tests and the
build, plus a `browser` job with both browser suites: Chrome with
`--no-sandbox` when `CI` is set, in a window under `xvfb-run` with
`HEADFUL=1` (headless Chrome on Linux reports `(hover: none)`, which
hides the hover UI the tests use). Deploys don't wait for CI.

**Releases:** bump `version` in package.json (`npm version X.Y.Z
--no-git-tag-version`, semver), commit, then tag that commit with an
annotated `vX.Y.Z` tag summarising the release and push it
(`git push origin vX.Y.Z`; origin pushes to GitHub and Codeberg). The
app shows `version · commit · build date` (`__KURUMI_VERSION__`) in
About and Settings → Offline & storage.

**Invariant:** `npx svelte-check` should always return
`0 errors and 0 warnings`. CI and local pre-push runs enforce this.

## Design decisions

### Why Automerge CRDTs?
- Conflict-free sync across devices without a central merge server
- Binary format is compact
- Local-first architecture with optional sync

### Why SvelteKit over Next.js?
- 40% smaller bundle (critical for a PWA that preloads local ML models)
- Svelte 5 runes are ergonomic for reactive state
- Static adapter deploys cleanly to Pages/GitHub Pages

### Why git sync over a dedicated backend?
- User owns the data — any GitHub/GitLab/Codeberg repo works
- Markdown round-trip means the repo is human-readable and grep-able
- Zero ongoing infrastructure cost

### Why put inference behind a router?
- Lets us register local providers first and fall back to remote
  without touching caller code
- Enables "private-first" or "offline-only" policies later without
  rewriting extraction pipelines
- Same interface works for transcribe / summarize / TTS / Q&A

## Contributing

MIT licensed (`LICENSE`). Fork and adapt for your own setup. The original
phase plan is `.claude/plans/kurumi-roadmap.md` (largely done); what's
next is tracked in `.claude/plans/next-phase-roadmap.md`.
