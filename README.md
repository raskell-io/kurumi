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
| **Meeting mode** | Long-form recording with structured summary, action items, decisions, participants |
| **Audio/video upload** | Import existing recordings for transcription and processing |
| **Camera capture** | Photo capture from webcam or mobile camera, stored as AVIF |
| **Web clipper** | Bookmarklet captures page title, URL, and selected text |
| **Share target** | Share content from any app directly into Kurumi (PWA) |
| **Daily notes** | Template-based daily journal with AI-generated reflection prompts |

### Organize

| Feature | Description |
|---------|-------------|
| **Folders** | Unlimited nesting, drag-and-drop, swipe-delete |
| **Vaults** | Separate workspaces with independent data |
| **Tags** | Auto-extracted from #hashtags, merge and normalize duplicates |
| **People** | First-class @mention entities with duplicate detection and merge |
| **Topics & Projects** | Extracted entities with dedup workflow |
| **Smart folders** | Saved query views that auto-populate by type, tag, person, or text |
| **Canvas** | Spatial workspace — place notes as cards, draw connections |
| **Database views** | Table and board views with grouping and filtering |

### Recall

| Feature | Description |
|---------|-------------|
| **Full-text search** | MiniSearch keyword index, `Cmd+K` command palette |
| **Semantic search** | Local embeddings (MiniLM / multilingual-e5) for meaning-based recall |
| **Ask Kurumi** | Hybrid keyword + semantic retrieval with inline `[n]` citations |
| **Graph view** | Force-directed visualization of note connections |
| **Read mode** | Blog-style browsing with folder, tag, date, and person filter routes |
| **Timeline** | Vertical chronological view of all captures, filterable by type/person/tag |
| **Calendar** | Month grid with color-coded dots for notes, voice memos, meetings, and due actions |
| **Weekly review** | Stats, AI summary, overdue items, pending proposals |
| **Linked note suggestions** | Semantic backlinks surfaced on every note |

### AI Assistant

| Feature | Description |
|---------|-------------|
| **Agent chat** | Multi-turn streaming conversation with 10 tools (search, create, update notes, action items, reminders, people, topics) |
| **Chat to note** | Have a conversation, then save the result as a note — per-message or distilled |
| **Reference autocomplete** | Type `[[`, `@`, `#`, `//` in the agent chat for note/person/tag/date completion |
| **Voice commands** | "Create a note about...", "Remind me to...", "What's due today" from push-to-talk |
| **Transcription** | Whisper (local via transformers.js) with OpenAI fallback |
| **Summarization** | Auto-generated short and long summaries for voice memos and meetings |
| **Entity extraction** | Participants, topics, projects, action items extracted from transcripts |
| **Reminder proposals** | Time-anchored follow-ups extracted from memories, reviewed in `/proposals` |
| **Draft proposals** | Email and calendar event drafts extracted from meetings |
| **Daily digest** | Auto-generated on first app open each day |
| **Inference routing** | Local-first with remote fallback; policy modes (private-first, best-quality, offline-only) |

### Act

| Feature | Description |
|---------|-------------|
| **Action items** | Extracted from meetings or manually created, with status, due dates, recurrence, assignees |
| **Inbox** | Unified triage view: overdue actions, due today, pending proposals, unsummarized memos, untagged notes |
| **Focus timer** | Pomodoro timer linked to action items, global progress bar with pause/resume/chime |
| **Habits** | Daily habit tracker with week toggles and 60-day contribution heatmap |
| **Flashcards** | Spaced repetition (SM-2) with AI-generated Q&A from notes |
| **Browser notifications** | Due action item alerts while the app is open |

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
| **Cloudflare R2** | S3-compatible sync |
| **S3 / Azure Blob / WebDAV** | Additional sync targets |
| **Local filesystem** | File System Access API for local folder sync |
| **Conflict resolution** | Side-by-side merge modal for real conflicts |
| **Markdown export** | Vanilla, Hugo, or Zola format with full front matter |
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
| **Wikilinks** | `[[Note Title]]` with autocomplete and backlink tracking |
| **Mermaid diagrams** | Fenced `mermaid` code blocks render as interactive SVGs |
| **DataviewBlocks** | Embedded `kurumi` query blocks with list/table/board views |
| **Code blocks** | Syntax highlighting with copy button and language label |
| **Callouts** | Obsidian-style `> [!info]` callout blocks |
| **Embeds** | `![[Title]]` to embed another note inline |
| **Math** | LaTeX `$inline$` and `$$block$$` syntax |
| **Audio embeds** | Inline audio players for voice recordings |

---

## Installation

### Use Online

Visit [kurumi.raskell.io](https://kurumi.raskell.io) and install as a PWA.

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

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Command palette / search |
| `Cmd/Ctrl + N` | New note |
| `Cmd/Ctrl + D` | Today's daily note |
| `Cmd/Ctrl + G` | Graph view |
| `Cmd/Ctrl + R` | References |
| `Cmd/Ctrl + Z` | Undo last destructive action |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + `` ` | Toggle agent chat |
| `Cmd/Ctrl + Shift + R` | Read mode |
| `Cmd/Ctrl + Shift + A` | Action items |
| `Cmd/Ctrl + Shift + I` | Inbox |
| `Cmd/Ctrl + Shift + C` | Calendar |
| `Cmd/Ctrl + Shift + V` | Voice assistant push-to-talk |
| `Cmd/Ctrl + Shift + F` | Toggle focus mode |

---

## Sync

Kurumi supports multiple sync backends. Configure in Settings:

| Backend | Description |
|---------|-------------|
| **Git** | Push/pull markdown + metadata to any Git host via CORS proxy |
| **Cloudflare R2** | S3-compatible object storage (free tier is plenty) |
| **AWS S3** | Standard S3 with signed requests |
| **Azure Blob** | Azure cloud storage |
| **WebDAV** | Nextcloud, Synology, or any WebDAV server |
| **Local FS** | File System Access API for local folder sync |

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
│   Sync: Git · R2 · S3 · WebDAV · Azure    │
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
