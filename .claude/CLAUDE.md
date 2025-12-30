# Kurumi (クルミ)

*Walnut in Japanese - because it looks like a brain*

A local-first, web-based personal knowledge management system with AI augmentation. Think Obsidian, but as a PWA that works everywhere.

## Vision

Kurumi is your **second brain** - a place to capture, connect, and cultivate ideas. It's designed to be:

- **Portable**: Access from any device (MacBook, iPhone, work computer)
- **Local-first**: Works offline, you own your data
- **Future-proof**: Markdown-based, no vendor lock-in
- **AI-augmented**: Multiple AI providers to help refine and connect ideas

## Core Principles

1. **Your data, your control** - Everything stored locally in IndexedDB, synced via your own Cloudflare account
2. **Offline-first** - Full functionality without internet, sync when connected
3. **Plain text at heart** - Markdown content, exportable anytime
4. **Minimal friction** - Fast capture, instant search, keyboard-driven

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | SvelteKit 2 + Svelte 5 | Small bundles, excellent DX, runes are great |
| Styling | Tailwind CSS 4 | Utility-first, fast iteration |
| Data | Automerge CRDTs | Conflict-free sync across devices |
| Storage | IndexedDB (idb-keyval) | Fast local persistence |
| Editor | Milkdown | Markdown WYSIWYG with live preview |
| Search | MiniSearch | Client-side full-text search |
| Graph | force-graph | WebGL visualization for note connections |
| PWA | @vite-pwa/sveltekit | Offline support, installable |
| Sync | Cloudflare R2 + Workers | Free tier, global edge |
| AI | Multi-provider | OpenAI, Anthropic, Ollama, Google |

## Architecture

```
┌─────────────────────────────────────┐
│           Kurumi UI                 │
│  (SvelteKit + Svelte 5 Runes)       │
├─────────────────────────────────────┤
│         Automerge Documents         │  ← CRDT layer (conflict-free)
├─────────────────────────────────────┤
│     IndexedDB (via idb-keyval)      │  ← Local persistence
├─────────────────────────────────────┤
│   Cloudflare R2 (via Worker API)    │  ← Cross-device sync
└─────────────────────────────────────┘
```

## Data Model

```typescript
interface Note {
  id: string;
  title: string;
  content: string;      // Markdown
  tags: string[];
  folderId: string | null;
  created: number;
  modified: number;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;  // For nested folders
  created: number;
  modified: number;
}
```

## Key Features

### Implemented
- Note CRUD with auto-save
- Milkdown live-preview editor
- `[[Wikilinks]]` for linking notes
- Backlinks panel
- Full-text search (MiniSearch)
- Command palette (Cmd+K)
- Graph view (force-graph)
- Folders and subfolders
- Tags extraction and filtering
- Dark/light/system theme
- PWA (installable, offline-capable)
- Mobile-responsive design
- Keyboard shortcuts

### Planned
- Cloudflare R2 sync
- AI integration (refine ideas, find related notes)
- Semantic search with embeddings
- Markdown export/import
- Daily notes
- Templates

## Project Structure

```
kurumi/
├── src/
│   ├── lib/
│   │   ├── db/              # Automerge + IndexedDB
│   │   │   ├── types.ts     # Note, Folder interfaces
│   │   │   ├── store.ts     # CRUD operations, derived stores
│   │   │   └── index.ts     # Re-exports
│   │   ├── search/          # MiniSearch integration
│   │   └── components/      # Svelte components
│   │       ├── Editor.svelte
│   │       ├── CommandPalette.svelte
│   │       ├── FolderTree.svelte
│   │       └── Graph.svelte
│   ├── routes/
│   │   ├── +layout.svelte   # Main layout with sidebar
│   │   ├── +page.svelte     # Home/welcome
│   │   ├── note/[id]/       # Note editor
│   │   ├── graph/           # Graph view
│   │   └── settings/        # Settings page
│   └── app.css              # Global styles, theme variables
├── static/
│   ├── icon-*.avif          # App icons
│   └── manifest.json        # PWA manifest (generated)
├── .claude/
│   ├── CLAUDE.md            # This file
│   └── roadmap.md           # Development roadmap
└── package.json
```

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + N` | Create new note |
| `Cmd/Ctrl + G` | Open graph view |
| `Cmd/Ctrl + ,` | Open settings |
| `Escape` | Close modal/sidebar |

## Design Decisions

### Why Automerge CRDTs?
- Automatic conflict resolution when syncing across devices
- No central server required for conflict handling
- Binary format is compact and efficient
- Industry moving toward local-first architecture

### Why SvelteKit over Next.js?
- 40% smaller bundle sizes (critical for PWA)
- Svelte 5 runes provide excellent reactivity
- No hydration overhead
- Static adapter works perfectly for local-first

### Why Cloudflare for sync?
- Generous free tier (R2, Workers, Pages)
- Global edge network
- Simple bearer token auth sufficient for personal use
- No server maintenance

## Contributing

This is a personal project, but feel free to fork and adapt for your own needs.
