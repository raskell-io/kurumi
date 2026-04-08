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
│         Automerge Document (v11)           │
│  memoryObjects · folders · vaults ·        │
│  people · events · templates ·             │
│  actionItems · reminderProposals ·         │
│  draftProposals                            │
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
is **11** (incremented by migrations in `src/lib/db/store.ts`).

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
- `actionItems` — promoted from meeting drafts or manually created; have status (open/in_progress/done/cancelled) and dueDate
- `reminderProposals` — time-anchored nudges extracted from memories, awaiting user review (pending/approved/rejected/snoozed); approval creates an ActionItem
- `draftProposals` — email and calendar-event drafts extracted from memories (pending/used/rejected), user copies them into their real client

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
- Read mode (`/read`) — blog-style browsing with folder / tag / date
  / person / topic filter routes
- Graph view (`/graph`) — force-directed memory link visualization
- Weekly review (`/review`) — stats, AI summary, overdue + pending
- Folder tree with unlimited nesting, drag-drop, swipe-delete

### Process & Act (Phase 9 controlled action layer)
- **Action items** (`/actions`, `Cmd+Shift+A`) — promoted from meeting
  drafts or manually created. Inline edit, bulk select, mark done /
  in_progress / cancelled / delete. Due-today list on home page.
- **Reminder proposals** (`/proposals`) — time-anchored follow-ups
  extracted from memories. Approve → creates ActionItem with dueDate.
  Reject / snooze / reopen / delete. Audit log semantics.
- **Draft proposals** (`/drafts`) — email + calendar-event drafts
  extracted from memories. Copy-to-clipboard; no email/calendar API
  integration by design.
- **Browser notifications** — optional; fires for due action items
  every 60s while the app is open. Clicking jumps to `/actions`.

### Ontology maintenance (roadmap §6.6)
- **People merge** (`/people`) — detect duplicates, merge rewrites
  `@mentions` across all memory bodies + participant lists + action
  item assignees.
- **Tag normalization** (`/tags`) — merge dupes, rename, flag
  low-value tags (used once).
- **Topic / project merge** (`/topics`) — same dedupe workflow for the
  bare-string entity types.

### Sync
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
  questions
- Single-memory download from memory detail page
- Obsidian vault import
- Full JSON backup / restore

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
│   ├── actions/             # Action items dashboard
│   ├── daily/[date]/        # Daily notes
│   ├── drafts/              # Email/calendar draft review
│   ├── graph/               # Graph view
│   ├── memory/[id]/         # Memory detail + editor
│   ├── people/              # People management + merge
│   ├── proposals/           # Reminder proposals review
│   ├── read/                # Blog-style reader with filters
│   ├── references/          # Tags / people / dates / links browse
│   ├── review/              # Weekly review
│   ├── settings/            # All settings panels
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
| `Cmd/Ctrl + N` | New note |
| `Cmd/Ctrl + D` | Today's daily note |
| `Cmd/Ctrl + G` | Graph view |
| `Cmd/Ctrl + R` | References |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + Z` | Undo last destructive action |
| `Cmd/Ctrl + Shift + R` | Read mode |
| `Cmd/Ctrl + Shift + A` | Action items dashboard |
| `Cmd/Ctrl + Shift + V` | Voice assistant push-to-talk |
| `Escape` | Close modal/sidebar |

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
| `c` | Copy (drafts) |
| `Escape` | Clear selection / unfocus |

## Development

```bash
npm install
npm run dev          # dev server
npm run build        # production build
npm run preview      # preview built app
npx svelte-check     # type + a11y + css check (should be 0/0)
```

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

Personal project — fork and adapt for your own setup. The roadmap in
`.claude/plans/kurumi-roadmap.md` is the source of truth for phase
planning.
