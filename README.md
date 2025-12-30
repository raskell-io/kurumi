<div align="center">

<h1 align="center">
  <img src="static/icon-512.avif" alt="kurumi icon" width="96" />
  <br>
  Kurumi
</h1>

<p align="center">
  <em>A local-first second brain.</em><br>
  <em>Your ideas, everywhere, offline.</em>
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
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#philosophy">Philosophy</a>
</p>

<hr />

</div>

Kurumi (クルミ, "walnut" in Japanese - because it looks like a brain) is a personal knowledge management system built for the way you actually think: connected, non-linear, and always available.

It's designed for:
- **Capturing ideas** instantly, from any device
- **Connecting thoughts** through wikilinks and backlinks
- **Working offline** with full functionality
- **Owning your data** with local-first architecture

---

## Features

| Feature | Description |
|---------|-------------|
| **Wikilinks** | Link notes with `[[Note Title]]` syntax |
| **Backlinks** | See what links to the current note |
| **Graph View** | Visualize connections between notes |
| **Full-text Search** | Find anything instantly with Cmd+K |
| **Folders** | Organize notes hierarchically |
| **Tags** | Extract and filter by #hashtags |
| **Offline-first** | Works without internet, syncs when connected |
| **PWA** | Install on any device, feels native |
| **Dark Mode** | Light, dark, and system themes |

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

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + N` | Create new note |
| `Cmd/Ctrl + G` | Open graph view |
| `Cmd/Ctrl + ,` | Open settings |
| `Escape` | Close modal/sidebar |

### Linking Notes

Type `[[` to start a wikilink. Notes are matched by title (case-insensitive). If the note doesn't exist, clicking the link creates it.

```markdown
This connects to [[Another Idea]] and relates to [[Project Planning]].
```

### Tags

Use `#hashtags` anywhere in your notes. Tags are automatically extracted and appear in the sidebar for filtering.

```markdown
Working on the #mvp for #kurumi today.
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | SvelteKit 2 + Svelte 5 |
| Styling | Tailwind CSS 4 |
| Data | Automerge CRDTs |
| Storage | IndexedDB |
| Editor | Milkdown |
| Search | MiniSearch |
| Graph | force-graph |
| PWA | @vite-pwa/sveltekit |

---

## Philosophy

- **Your data, your control**
  Everything stored locally. No account required. Export anytime.

- **Offline-first, not offline-capable**
  Full functionality without internet. Sync is a feature, not a requirement.

- **Plain text at heart**
  Markdown content that's readable in 50 years.

- **Minimal friction**
  Fast capture, instant search, keyboard-driven.

- **No vendor lock-in**
  Automerge CRDTs mean your data syncs without a central server.

---

## Architecture

```
┌─────────────────────────────────────┐
│           Kurumi UI                 │
│    (SvelteKit + Svelte 5 Runes)     │
├─────────────────────────────────────┤
│       Automerge Documents           │  ← Conflict-free sync
├─────────────────────────────────────┤
│   IndexedDB (via idb-keyval)        │  ← Local persistence
├─────────────────────────────────────┤
│    Cloudflare R2 (optional)         │  ← Cross-device sync
└─────────────────────────────────────┘
```

---

## Roadmap

See [.claude/roadmap.md](.claude/roadmap.md) for the full development roadmap.

**Next up:**
- Cloudflare R2 sync for cross-device access
- AI integration (refine ideas, find related notes)
- Markdown export/import
- Daily notes

---

## Part of the Raskell.io Family

Kurumi is part of the [raskell.io](https://raskell.io) ecosystem, alongside:
- [Sentinel](https://sentinel.raskell.io) - Security-first reverse proxy built on Pingora
- [Ushio](https://github.com/raskell-io/ushio) - Deterministic edge traffic replay
- [Sango](https://github.com/raskell-io/sango) - Operator-grade edge diagnostics
- [Tanuki](https://tanuki.raskell.io) - Agent registry

---

## License

MIT
