<div align="center">

<h1 align="center">
  <img src="static/icon-512.avif" alt="kurumi icon" width="96" />
  <br>
  Kurumi
</h1>

<p align="center">
  <em>A local-first, AI-native second brain.</em><br>
  <em>Capture everything. Recall anything. Your data, your devices.</em>
</p>

<p align="center">
  <a href="https://svelte.dev/">
    <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte-5-ff3e00?logo=svelte&logoColor=white&style=for-the-badge">
  </a>
  <a href="https://automerge.org/">
    <img alt="Automerge" src="https://img.shields.io/badge/Automerge-CRDT-f5a97f?style=for-the-badge">
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/License-MIT-c6a0f6?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#capture">Capture</a> •
  <a href="#recall">Recall</a> •
  <a href="#ai-assistant">AI</a> •
  <a href="#installation">Install</a> •
  <a href="#sync">Sync</a> •
  <a href="#philosophy">Philosophy</a>
</p>

<hr />

</div>

Kurumi (クルミ, "walnut" in Japanese — because it looks like a brain) is a personal memory assistant built as a local-first PWA. It captures typed notes, voice memos, and meetings, then helps you recall and act on them with AI. Everything works offline, syncs through your own infrastructure, and routes inference between on-device models and remote APIs.

---

## Features

### Capture

| Feature | Description |
|---------|-------------|
| **Typed notes** | Milkdown markdown editor with wikilinks, @mentions, #tags, //dates, templates, slash commands |
| **Voice memos** | Record with pause/resume, waveform visualization, auto-transcription |
| **Meeting mode** | Long-form recording with structured summary, to-dos, decisions, participants |
| **Audio/video upload** | Import existing recordings for transcription and processing |
| **Camera capture** | Photo capture from webcam or mobile camera, stored as AVIF |
| **Web clipper** | Bookmarklet captures page title, URL, and selected text |
| **Share target** | Share text, links, images, recordings and files from any app into Kurumi (installed app) |
| **File attachments** | Paste or drop any file into a note; PDFs and documents show as chips that open or download |
| **Optimize vault** | Settings → Offline & storage: a faster storage format for big vaults (10,000 notes: load 12 s → under 1 s), undoable |
| **Offline app** | Installable, starts without a connection, icon shortcuts and due to-do badge, opens `.md` files |
| **Daily notes** | Template-based daily journal with AI-generated reflection prompts |

### Organize

| Feature | Description |
|---------|-------------|
| **Folders** | Unlimited nesting, drag-and-drop, hover `+`/`⋯` actions, right-click menus (rename, copy `[[link]]`, move), swipe-delete on touch |
| **Vaults** | Separate workspaces with independent data; built-in icon or your own uploaded logo, editable any time |
| **Favorites** | Star notes to pin them to the top of the sidebar |
| **Page icons** | Give any note an emoji or uploaded image icon, shown in the tree, tabs, switcher and link previews |
| **Tags** | Auto-extracted from #hashtags, merge and normalize duplicates |
| **People** | Everyone you @mention is listed; save a person to add details, detect duplicates and merge them |
| **Topics & Projects** | Extracted entities with dedup workflow |
| **Smart folders** | Saved query views that auto-populate by type, tag, person, or text |
| **Canvas** | Spatial workspace — place notes as cards, draw connections |
| **Database views** | Table and board views with grouping and filtering |
| **Tab bar** | Recently-opened notes as draggable tabs with stable ordering; middle-click to close |
| **Undo** | Deletes go to Trash and every destructive action can be undone from the toast or with `Cmd/Ctrl+Z`; blank new notes you never touch are discarded automatically |

### Recall

| Feature | Description |
|---------|-------------|
| **Full-text search** | MiniSearch keyword index, `Cmd+K` command palette |
| **Semantic search** | Local embeddings (MiniLM / multilingual-e5) for meaning-based recall |
| **Ask Kurumi** | Hybrid keyword + semantic retrieval with inline `[n]` citations |
| **Graph view** | Force-directed visualization of note connections |
| **Read mode** | Blog-style browsing with folder, tag, date, and person filter routes |
| **Timeline** | Date-grouped view of all captures, filterable by type/person/tag |
| **Calendar** | Month grid showing notes, voice memos, meetings, and due actions per day |
| **Weekly review** | Stats, AI summary, overdue items, pending proposals |
| **Linked note suggestions** | Semantic backlinks surfaced on every note |

### AI Assistant

| Feature | Description |
|---------|-------------|
| **Agent chat** | Multi-turn streaming conversation with 10 tools (search, create, update notes, to-dos, reminders, people, topics) |
| **Chat to note** | Have a conversation, then save the result as a note — per-message or distilled |
| **Reference autocomplete** | Type `[[`, `@`, `#`, `//` in the agent chat for note/person/tag/date completion |
| **Voice commands** | "Create a note about...", "Remind me to...", "What's due today" from push-to-talk |
| **Transcription** | Whisper (local via transformers.js) with OpenAI fallback |
| **Summarization** | Auto-generated short and long summaries for voice memos and meetings |
| **Entity extraction** | Participants, topics, projects, to-dos extracted from transcripts |
| **Reminder proposals** | Time-anchored follow-ups extracted from memories, reviewed in `/proposals` |
| **Draft proposals** | Email and calendar event drafts extracted from meetings |
| **Daily digest** | Auto-generated on first app open each day |
| **Inference routing** | Local-first with remote fallback; policy modes (private-first, best-quality, offline-only) |

### Act

| Feature | Description |
|---------|-------------|
| **To-dos** | Extracted from meetings or manually created, with status, due dates, recurrence, assignees; list or Kanban board, filter by project or assignee |
| **Waiting for** | To-dos assigned to other people, per person, on the To-dos page and each person's page |
| **Projects** | Notes, to-dos, decisions, open questions and meetings per project; suggested from the project names your notes already use |
| **Decision log** | What was decided, when and why; meetings add their decisions automatically |
| **Open questions** | Tracked until answered; meetings add their unresolved questions automatically |
| **Recurring meetings** | 1:1s and syncs with a running agenda; starting one creates the meeting note with agenda, open to-dos and questions |
| **Inbox** | Unified triage view: overdue actions, due today, pending proposals, unsummarized memos, untagged notes |
| **Focus timer** | Pomodoro timer linked to to-dos, global progress bar with pause/resume/chime |
| **Habits** | Daily habit tracker with week toggles and 60-day contribution heatmap |
| **Flashcards** | Spaced repetition (SM-2) with AI-generated Q&A from notes |
| **Browser notifications** | Due to-do alerts with Mark done / Snooze buttons |

### Privacy & Security

| Feature | Description |
|---------|-------------|
| **Local-first** | All data stored in IndexedDB on your device |
| **PIN lock** | Optional PIN-based lock screen with auto-lock on idle and tab hide |
| **No account required** | No sign-up, no server, no tracking |
| **Your keys** | API keys stored locally, never transmitted to third parties |

### Sync & Export

| Feature | Description |
|---------|-------------|
| **Git sync** | Push/pull via isomorphic-git to GitHub, GitLab, Codeberg through CORS proxy |
| **Kurumi sync server** | Your own server on a free Cloudflare account: one-click deploy, connect from its page, add devices with a link |
| **End-to-end encryption** | Optional sync passphrase: notes and files are encrypted (AES-256-GCM) before upload |
| **S3 / Azure Blob / WebDAV** | Additional sync targets |
| **Local filesystem** | File System Access API for local folder sync, current vault or all vaults; markdown files and folders you add there are imported |
| **Local git agent** | `agent/kurumi-agent.mjs` commits that folder and pulls/pushes it with your system git: no token in the browser, no CORS proxy |
| **Conflict resolution** | Side-by-side merge modal for real conflicts |
| **Markdown export** | Vanilla, Hugo, or Zola format with full front matter; current vault or all vaults |
| **Rich text copy** | Copy note as formatted HTML to clipboard |
| **Share** | Web Share API (mobile share sheet) with clipboard fallback |
| **HTML publish** | Download self-contained HTML page for any note |
| **vCard / iCal / CSV** | Export people, events, tags |
| **Import** | Obsidian vault, Roam Research JSON, Evernote ENEX |

### Editor

| Feature | Description |
|---------|-------------|
| **Milkdown** | WYSIWYG markdown with live preview |
| **Slash commands** | 20+ built-in: headings, lists, code, callouts, embeds, camera, templates |
| **Wikilinks** | `[[Note Title]]` with autocomplete, hover previews, and linked/unlinked mention tracking |
| **Inline autocomplete** | `[[`, `@`, `#`, `//` suggest as you type without taking the cursor out of the text — arrows to pick, `Enter`/`Tab` to accept, `Esc` to dismiss |
| **Mermaid diagrams** | Fenced `mermaid` code blocks render as interactive SVGs |
| **DataviewBlocks** | Embedded `kurumi` query blocks with list/table/board views |
| **Code blocks** | Syntax highlighting with copy button and language label |
| **Callouts** | Obsidian-style `> [!info]` callout blocks |
| **Embeds** | `![[Title]]` renders the other note live, right in the editor |
| **Block handles** | Hover a block for `+` (add below) and `⋮⋮` (drag to move, or Turn into / Duplicate / Delete) |
| **Find & replace** | `Cmd/Ctrl+F` in a note, `Cmd/Ctrl+Option+F` to replace, in this note or across all notes (undoable) |
| **Tasks** | `[] ` or `/checkbox` for to-dos with real, clickable checkboxes |
| **Paste links** | Paste a URL over selected text to link it |
| **Paste formatting** | Paste from ChatGPT, web pages, Google Docs or a markdown editor and keep headings, lists, tables, code and links |
| **Split view** | Alt+click a note or `[[link]]` to open it beside the current one |
| **Mobile toolbar** | Formatting bar above the on-screen keyboard |
| **Math** | LaTeX `$inline$` and `$$block$$` syntax |
| **Audio embeds** | Inline audio players for voice recordings |
| **Version history** | Browse and restore earlier versions of any note |

---

## Installation

### Use Online

Visit [kurumi.raskell.io](https://kurumi.raskell.io) and install as a PWA.

| | Chrome / Edge (desktop, Android) | Safari (Mac) | iPhone / iPad (home screen) | Firefox |
|---|---|---|---|---|
| Notes, search, to-dos, offline | ✓ | ✓ | ✓ | ✓ |
| Install as an app | ✓ | ✓ (Dock) | ✓ | — |
| Share into Kurumi from other apps | Android | — | — | — |
| Open `.md` files with Kurumi | desktop | — | — | — |
| Due to-do reminders in the background | ✓ | — | — | — |

Apple doesn't give web apps the share sheet, file opening or background
checks, so on iPhone and iPad those need Kurumi open.

### Run Locally

```bash
git clone https://github.com/raskell-io/kurumi.git
cd kurumi
npm install
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview
```

### Checks

```bash
npm test                                   # unit tests (Vitest)
npm run test:e2e                           # browser smoke tests (headless Chrome; set CHROME_PATH if needed)
npx svelte-check --tsconfig ./tsconfig.json   # types, a11y, CSS — should report 0 errors and 0 warnings
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Command palette / search |
| `Cmd/Ctrl + O` / `P` | Quick switcher (recent notes first) |
| `Cmd/Ctrl + N` | New note |
| `Cmd/Ctrl + D` | Today's daily note |
| `Cmd/Ctrl + G` | Graph view |
| `Cmd/Ctrl + R` | References |
| `Cmd/Ctrl + Z` | Undo last destructive action |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + `` ` | Toggle agent chat |
| `Cmd/Ctrl + Shift + R` | Read mode |
| `Cmd/Ctrl + Shift + A` | To-dos |
| `Cmd/Ctrl + Shift + I` | Inbox |
| `Cmd/Ctrl + Shift + C` | Calendar |
| `Cmd/Ctrl + Shift + V` | Voice assistant push-to-talk |
| `Cmd/Ctrl + Shift + F` | Toggle focus mode |
| `Cmd/Ctrl + \` | Collapse / expand sidebar |
| `Cmd/Ctrl + F` | Find in note |
| `Cmd/Ctrl + Option/Alt + F` | Find and replace |
| `Escape` | Close the open menu, dialog, or sidebar |

`Cmd/Ctrl + K`, `O`, `P`, `N`, `F`, and `Cmd/Ctrl + \` also work while you're typing in a note. All of these can be changed in Settings → Keyboard shortcuts.

On list pages (actions, proposals, drafts, inbox, people, tags, topics):

| Key | Action |
|-----|--------|
| `j` / `k` (or `↓` / `↑`) | Move between items |
| `Enter` | Open the item (or its source note) |
| `Space` | Select for bulk actions (actions, proposals, drafts) |
| `x` | Mark done (actions) |
| `a` / `r` / `s` | Approve / reject / snooze (proposals); `r` also rejects drafts |
| `e` / `c` | Edit (actions) / copy (drafts) |
| `d` | Delete (undoable) |

In read mode, `/` focuses the filter; in flashcard review, `Space` reveals and `1`–`4` grade.

---

## Sync

The easiest way: your own **Kurumi sync server** on a free Cloudflare
account, no command line needed.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/raskell-io/kurumi/tree/main/worker)

Deploy it, open its page and click *Connect Kurumi*; other devices join
with the link from Settings → Sync → *Add a device*. Details in
[worker/README.md](worker/README.md).

All backends (Settings → Sync):

| Backend | Description |
|---------|-------------|
| **Kurumi sync server** | A Cloudflare Worker + R2 on your account ([worker/](worker/)) |
| **Git** | Push/pull markdown + metadata to any Git host via CORS proxy |
| **AWS S3** | Standard S3 with signed requests |
| **Azure Blob** | Azure cloud storage |
| **WebDAV** | Nextcloud, Synology, or any WebDAV server |
| **Local FS** | File System Access API for local folder sync |

**End-to-end encryption** (Kurumi server, S3, Azure, WebDAV): set a sync
passphrase and the storage only holds ciphertext. Git and the local
folder stay plain markdown by design.

To keep vaults in a GitHub repo without handing the browser a token, use
Local FS together with the local agent; see [agent/README.md](agent/README.md).

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | SvelteKit 2 + Svelte 5 runes | Small bundles, excellent DX |
| Styling | Tailwind CSS 4 + CSS variables | Utility-first + themeable |
| Data | Automerge CRDTs | Conflict-free local storage |
| Storage | IndexedDB | Fast local persistence |
| Editor | Milkdown | Markdown WYSIWYG |
| Search | MiniSearch + local embeddings | Hybrid keyword + semantic recall |
| Graph | force-graph | WebGL connection visualization |
| Diagrams | Mermaid | Rendered in markdown code blocks |
| PWA | @vite-pwa/sveltekit | Offline + installable |
| Sync | isomorphic-git | Git sync to any host |
| Local AI | transformers.js | Whisper, SmolLM2, Qwen, MiniLM, MMS TTS |
| Remote AI | OpenAI, Anthropic | Transcription, chat, TTS, extraction |
| Icons | Lucide | Consistent icon set |
| Fonts | Geist, iA Writer Quattro S | Editor and UI typography |

---

## Philosophy

- **Capture first, chat second.** Friction to save a thought should be near zero.
- **Local-first, not local-only.** Everything works offline; remote is the fallback.
- **Human-in-the-loop.** The assistant proposes, you approve.
- **Plain text at heart.** Markdown bodies, YAML frontmatter, exportable. No vendor lock-in.
- **Policy-routed inference.** Tasks pick local vs. remote based on capability and preference.
- **Your data, your control.** No account, no server, no tracking. Export anytime.

---

## Architecture

```
┌────────────────────────────────────────────┐
│               Kurumi UI                    │
│       (SvelteKit + Svelte 5 runes)         │
├────────────────────────────────────────────┤
│      Inference Router (local → remote)     │
│   Whisper · SmolLM2 · OpenAI · Anthropic   │
├────────────────────────────────────────────┤
│         Automerge Document (v11)           │
│  memories · folders · vaults · people ·    │
│  events · templates · action items ·       │
│  proposals · drafts · flashcards           │
├────────────────────────────────────────────┤
│   IndexedDB (doc + blobs + embeddings +    │
│   model cache) + localStorage (settings)   │
├────────────────────────────────────────────┤
│   Sync: Kurumi server · Git · S3 · WebDAV │
└────────────────────────────────────────────┘
```

---

## Support

If you find Kurumi useful, consider supporting its development:

<a href="https://ko-fi.com/raskell">
  <img src="https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi&logoColor=white&style=for-the-badge" alt="Ko-fi">
</a>

---

## License

MIT
