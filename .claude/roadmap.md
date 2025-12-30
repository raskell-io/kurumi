# Kurumi Development Roadmap

## Phase 1: Core Foundation [COMPLETED]

- [x] SvelteKit 2 project setup with static adapter
- [x] Svelte 5 runes configuration
- [x] Tailwind CSS 4 integration
- [x] PWA setup with @vite-pwa/sveltekit
- [x] Automerge + IndexedDB persistence layer
- [x] Note CRUD operations
- [x] Basic routing and layout
- [x] Mobile-responsive sidebar

## Phase 2: Editor & Linking [COMPLETED]

- [x] Milkdown live-preview editor integration
- [x] Wikilink parsing and rendering (`[[Note Title]]`)
- [x] Wikilink click handling (navigate or create)
- [x] Backlinks panel on note page
- [x] Auto-save with debouncing

## Phase 3: Search & Navigation [COMPLETED]

- [x] Full-text search with MiniSearch
- [x] Command palette (Cmd+K)
- [x] Search results with navigation
- [x] Quick actions (new note, graph, settings)

## Phase 4: Organization [COMPLETED]

- [x] Tags extraction from content (#tag)
- [x] Tag filtering in sidebar
- [x] Folders and subfolders
- [x] Folder tree view with collapse/expand
- [x] Context menus for folder/note management
- [x] Move notes between folders
- [x] View mode toggle (folders/list)

## Phase 5: Visualization [COMPLETED]

- [x] Graph view with force-graph
- [x] Note connections visualization
- [x] Interactive navigation (click to open)
- [x] Hover highlighting

## Phase 6: Polish [COMPLETED]

- [x] Dark/light/system theme toggle
- [x] Keyboard shortcuts (Cmd+K, Cmd+N, Cmd+G, Cmd+,)
- [x] Empty states with onboarding tips
- [x] Delete confirmation modal
- [x] Mobile touch interactions

---

## Phase 7: Cloudflare Sync [NEXT]

- [ ] Set up Cloudflare R2 bucket
- [ ] Create Worker API for sync endpoint
  - [ ] GET /sync - fetch latest document
  - [ ] POST /sync - push merged document
  - [ ] Bearer token authentication
- [ ] Client sync logic
  - [ ] Fetch remote on app load
  - [ ] Merge with local (Automerge handles conflicts)
  - [ ] Push on save/interval
  - [ ] Sync status indicator
- [ ] Settings UI for sync configuration
  - [ ] Sync URL input
  - [ ] Auth token input
  - [ ] Manual sync button
  - [ ] Last synced timestamp
- [ ] Deploy to Cloudflare Pages

## Phase 8: AI Integration

- [ ] AI provider abstraction layer
  ```typescript
  interface AIProvider {
    id: string;
    name: string;
    chat(messages: Message[]): AsyncIterable<string>;
    embed?(text: string): Promise<number[]>;
  }
  ```
- [ ] Provider implementations
  - [ ] OpenAI (GPT-4o, o1)
  - [ ] Anthropic (Claude)
  - [ ] Ollama (local models)
  - [ ] Google (Gemini)
- [ ] Settings for API keys (stored in localStorage)
- [ ] AI features
  - [ ] "Refine this idea" - expand on current note
  - [ ] "Find related notes" - semantic similarity
  - [ ] "Summarize" - TL;DR of note
  - [ ] "Generate questions" - explore further
- [ ] Streaming responses UI
- [ ] Inline AI suggestions (optional)

## Phase 9: Semantic Search

- [ ] Generate embeddings via AI provider
- [ ] Store embeddings in IndexedDB
- [ ] Vector similarity search
- [ ] "Find similar notes" feature
- [ ] Automatic related notes suggestions

## Phase 10: Export & Import

- [ ] Markdown export
  - [ ] Single note with YAML frontmatter
  - [ ] Bulk export (all notes as .md files)
  - [ ] Include folder structure
- [ ] Markdown import
  - [ ] Single file
  - [ ] Folder of .md files
  - [ ] Obsidian vault import
- [ ] JSON backup/restore
- [ ] GitHub backup integration (optional)

## Phase 11: Daily Notes & Templates

- [ ] Daily notes page (/daily)
- [ ] Auto-create today's note
- [ ] Calendar view for navigation
- [ ] Note templates
  - [ ] Template management in settings
  - [ ] Apply template on new note
  - [ ] Template variables (date, title, etc.)

## Phase 12: Advanced Features

- [ ] Note versioning (Automerge history)
- [ ] Undo/redo support
- [ ] Table of contents for long notes
- [ ] Image attachments (stored as base64 or R2)
- [ ] Code block syntax highlighting
- [ ] Mermaid diagram support
- [ ] Task lists with checkboxes
- [ ] Note pinning
- [ ] Archive functionality

## Phase 13: Performance & Scale

- [ ] Virtual scrolling for large note lists
- [ ] Lazy loading for graph view
- [ ] Search index persistence
- [ ] Background sync with service worker
- [ ] Incremental Automerge sync

---

## Future Considerations

### Native Apps (Tauri)
- Desktop app for macOS/Windows/Linux
- Better file system integration
- System tray with quick capture

### Real-time Collaboration
- Upgrade to Cloudflare Durable Objects
- Or add PartyKit for WebSocket sync
- Shared workspaces

### Multi-user
- User authentication
- Shared notes/folders
- Permissions system

### Mobile Native
- Capacitor wrapper for iOS/Android
- Native share sheet integration
- Widget for quick capture

---

## Technical Debt & Improvements

- [ ] Add comprehensive TypeScript types
- [ ] Unit tests for db operations
- [ ] E2E tests with Playwright
- [ ] Accessibility audit (a11y)
- [ ] Performance profiling
- [ ] Bundle size optimization
- [ ] Error boundary components
- [ ] Offline queue for failed syncs
