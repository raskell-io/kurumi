# Kurumi advanced roadmap — "OpenClaw meets Notion/Obsidian"

Living feature plan for turning Kurumi from "great solo PKM app" into
an AI-native PKM tool that rivals Notion + Obsidian + a persistent
agentic assistant. The original Phase 1-9 roadmap lives in
`.claude/plans/kurumi-roadmap.md` and is substantially done — this
document tracks what's next.

Check items off as they land. Keep scope notes and dependencies honest
so we don't burn a week on something that turned out to be half a day.

---

## Current state (snapshot)

Already shipped and working:

- Markdown-first local storage (Automerge + IndexedDB)
- Wikilinks, backlinks, tags, graph view
- Git sync with conflict resolution
- AI inference router (local Whisper/SmolLM/Llama, remote OpenAI)
- Voice memos, meeting mode, transcription
- Ask Kurumi with hybrid keyword+semantic retrieval + citations
- Realtime API voice session (untested against live endpoint)
- Reminder proposals with recurring support
- Draft proposals (email / calendar)
- To-dos dashboard (ActionItem; list or board) with inline edit / bulk ops / undo
- Weekly review page
- Daily notes
- People / tag / topic / project merge with full undo
- Search filter operators (tag: person: folder: type: has: after: before:)
- Browser notifications + background sync
- Keyboard navigation on every list page
- Command palette
- Markdown export (vanilla/hugo/zola), Obsidian/Roam/markdown-folder import
- Templates with variable substitution
- Trash with 30-day retention
- Multi-vault support
- Work: projects, decisions, open questions, recurring meetings, waiting-for,
  person pages, file attachments
- Installable offline PWA: share target (text, images, recordings, files),
  icon shortcuts, badge, notification actions, `.md` file handling

---

## Tier 1 — biggest impact, highest strategic value

Roughly in order of "what would change the feel of the app the most."

### [x] Slash commands in the editor
**Why:** The single UX feature that most defines the Notion experience.
Type `/` to insert any block type or run any command (create memory,
search, ask Kurumi, insert template, embed another memory). Sets up
every future feature as "another slash entry."

**Scope:** Medium. Milkdown has a slash-command plugin pattern; we'd
define a command registry + popup UI. The registry should be extensible
so AI commands, macros, and future block types can all register against
the same surface.

**Dependencies:** None. Pure editor work.

### [x] Dataview-style inline queries
**Why:** Leverages the search filter operators we just shipped. Turns
Kurumi from "notes with search" into "notes that compute over
themselves." A code block with `lang=kurumi` runs a query and renders
a live table/list/board inline.

**Scope:** Medium. Parser already exists (`parseSearchQuery`). Need a
Milkdown custom node that replaces the rendered code block with a
reactive result widget. Views: table, list, board (kanban), calendar.

**Example:**
````markdown
```kurumi
type:meeting tag:work after:2026-01-01
view: board
group: participants
limit: 50
```
````

**Dependencies:** Slash commands would make it easier to insert. Not a
hard dep.

### [x] Agentic chat pane with tool use
**Why:** The genuine differentiator versus both Notion and Obsidian.
Neither has a persistent assistant that can take real actions against
the vault with approval gates. Kurumi already has all the building
blocks — retrieval, mutation helpers, proposals, merges, extraction —
so wiring them into a tool registry is a straightforward next step.

**Scope:** Medium-large. Components:
- Right-side dockable chat panel (toggle via Cmd+`)
- Tool registry: `search_memory`, `create_memory`, `update_memory`,
  `delete_memory`, `add_action_item`, `approve_proposal`, `merge_people`,
  `run_query`, `summarize_folder`, `tag_memories`, ...
- Approval-gated execution: destructive tools show a confirm card
  inline in the chat before running
- Persistent conversation threads saved as memories
- Tool call visualization (expanded panels showing args/results)

**Dependencies:** Realtime API verification should land first so we
can share session infra. Reuses `retrieveMemoryContext` from ask.ts.

### [x] Typed databases / custom properties
**Why:** Notion's second killer feature. Lets users promote certain
memory types to tables with user-defined properties. "Projects database"
with status / owner / due / priority columns, backed by MemoryObject
with a new `properties: Record<string, PropertyValue>` field.

**Scope:** Medium-large. Schema migration. Property types: text,
number, date, select, multi-select, person, file, checkbox, URL,
formula (stretch). Views: table, board, calendar, gallery, timeline.

**Dependencies:** None, but pairs naturally with inline queries.

### [x] Canvas / infinite 2D board
**Why:** Obsidian Canvas is the single most-loved feature they shipped
in the last few years. Nothing in Kurumi supports spatial thinking.

**Scope:** Medium-large. New route `/canvas/[id]`. Memory cards
draggable onto a zoomable SVG/Canvas surface, arrows drawable between
cards, freehand drawing as a stretch. Persistence as a new memory
subtype (`type: 'canvas'`) with a JSON payload of nodes + edges.

**Dependencies:** None.

---

## Tier 2 — rich editor blocks

Each of these is a relatively self-contained block type that could
ride on top of the slash commands work above.

### [x] Callouts (info / warn / success / quote / tip)
Styled boxes with an icon and accent colour. Rendered in read mode
via pre-processing `> [!type]` syntax into styled divs.

### [x] Toggles / collapsible sections
HTML `<details>/<summary>` rendered natively by marked + styled.
Slash command `/toggle` inserts the scaffold.

### [x] Columns / multi-column layout
`::::columns` / `:::column` container directives (`editor/columns.ts`),
shipped in v0.6.0.

### [x] Embeds (YouTube / Twitter / Figma / maps / PDF / image / audio)
YouTube URLs auto-convert to responsive iframes in read mode.
Other embed types can follow the same pattern.

### [x] Memory embeds (`![[title]]`)
`![[Title]]` renders as a linked preview card with title + summary.
Slash command `/memory-embed` inserts the syntax.

### [x] Native inline-editable tables
Tab navigation (GFM preset) plus a toolbar while the cursor is in a table
(`editor/tableToolbar.ts`, grid ops in `tableGrid.ts`): insert/move/delete
rows and columns, align, sort. Column widths aren't stored: GFM has no
syntax for them.

### [x] LaTeX math
`$inline$` and `$$block$$` rendered as styled monospace blocks.
Slash commands `/math-block` and `/math-inline`. Full KaTeX
rendering can be added as a future dep.

### [x] Syntax-highlighted code blocks
lowlight (highlight.js grammars), loaded on first use: `$lib/highlight.ts`
for tokens, decorations in `editor/codeHighlight.ts` (header with language
picker + copy), spans in Read mode.

### [x] Inline action items
`- [ ]` lines in any note are mirrored as ActionItems (`$lib/note-tasks.ts`,
`reconcileNoteTasks` in store.ts). The line is the truth; ids are derived
from note id + text (`nt-…`) so devices don't duplicate them; /actions
writes status, date and assignee back into the line.

### [x] Callout-style AI suggestions
Unlinked mentions of other notes' titles are underlined in the editor
(`editor/linkSuggest.ts`, matching in `$lib/link-suggestions.ts`; link or
dismiss). A near-duplicate (embedding similarity ≥ 0.9) shows a bar above
the note with Compare. Embeddings, not an LLM: instant, offline, private.

---

## Tier 3 — agentic / AI-native differentiators

Where Kurumi surpasses rather than catches up to the incumbents.

### [x] Daily digest agent
Generates a note summarizing yesterday's captures, open action items,
and pending proposals with an LLM narrative summary. Triggered via
home page button or the agent chat's generate_daily_digest tool.

**Scope:** Small-medium. Needs the chat tool infra from Tier 1 OR a
simpler standalone scheduled job that writes a memory.

### [x] Weekly review agent
`$lib/weekly-review.ts`: a note for each Monday–Sunday week, written on the
first start of the next week (quiet weeks skipped), from /review, ⌘K or the
agent tool `generate_weekly_review`. Fixed id per vault + week, so devices
don't duplicate it.

### [x] Proactive pattern detection
Background analysis that surfaces observations:
- "You've mentioned Alice in 6 meetings this month — want a dedicated
  Person page?"
- "3 notes about Project X haven't been touched in months — still
  relevant?"
- "Your tag `work` has 180 memories — consider splitting into
  `work/meetings`, `work/planning`, etc."

**Scope:** Medium. Runs during idle time or on /review open. Produces
proposal-style suggestions the user approves or dismisses.

### [x] AI-authored templates
Point at 3-5 example notes of the same type; the LLM extracts a
template with placeholder variables. Saved as a regular template.
Implemented as `generateTemplateFromExamples` in digest.ts.

**Scope:** Small. One inference call, standard template save.

### [x] Living notes ("evolving understanding")
`$lib/living-notes.ts`, `MemoryObject.living` ({ query, signature,
updatedAt, sources }): follows a search query; rewritten (answerWithContext,
remote providers with a key only) when its sources' signature changed, at
most every 6 h (layout timer) or on Update now. Starts from the current
text so user edits survive; version history is the Automerge history.
Not carried by git sync's markdown/metadata.

### [x] Semantic backlinks
Beyond wikilinks — things that are *about* this memory, inferred via
embedding similarity. Shown alongside explicit backlinks as "Related
memories" on the read mode page. Uses `findSemanticBacklinks` in
digest.ts which queries the existing embedding index.

**Scope:** Medium. Embeddings already exist; needs a ranker + UI
surface on the memory detail page.

### [ ] Knowledge-graph chat navigator
Chat mode optimized for graph exploration: "what do we know about
Alice's Q4 priorities?" → walks entity links, returns synthesized
answer with a visual graph fragment of the path taken.

**Scope:** Large. Builds on the agentic chat pane.

### [x] Persistent agent memory
`$lib/agent-memory.ts`: facts in a "Kurumi memory" note per vault, managed
by the agent's `remember` / `forget` tools and put in the system prompt of
every conversation. `recall_conversations` searches past chats on the
device (they were already kept per device; "Save conversation as note"
puts one in the vault).

### [ ] Multi-step agentic workflows
User defines a workflow in natural language ("every Monday morning:
scan last week's meetings, extract new action items, group by
project, write a summary to a new daily note, notify me"). The
scheduler runs it in the background.

**Scope:** Large. Workflow definition language, scheduler,
execution context, observability.

---

## Tier 4 — workspace & navigation polish

### [x] Split-pane editor
A second note beside the main one (`SplitPane.svelte`); Alt+click a tree
row or `[[link]]`. One split, not Obsidian-style arbitrary splits.

### [x] Saved searches in the sidebar
Pin a filter query with a name. Data model: SavedSearch type in
KurumiDocument (v14→v15). Rendered in the sidebar above the folder
tree. CRUD in store.ts.

### [x] Sticky notes bar
Pinned tabs (`pinnedTabIds` in `stores/workspace.ts`): left of the tab bar,
kept per device across restarts, outside the 12-tab limit. Pin from the
tab, right-click, or ⌘K.

### [x] Search within a memory
Cmd+F find bar scoped to the note, Cmd+Alt+F find and replace, also
across notes (`editor/findReplace.ts`, `FindBar.svelte`).

### [x] Outgoing links sidebar
Extracts [[wikilinks]] from the current memory and renders resolved
links in a section above backlinks on the read mode page.

### [x] Bread-crumb navigation
Folder path above the note title (with page icons); the tab bar covers
the recent-memory trail.

### [x] Tab bar for recently-opened memories
Browser-style tab strip at the top of the main content area. Tracks
up to 12 recently-opened memories via $lib/stores/workspace.ts.
Active tab highlighted. Click X to close. Hidden in focus mode.

### [x] Focus mode
Cmd+Shift+F hides the sidebar for distraction-free writing. Focus
state stored in $lib/stores/workspace.ts.

---

## Tier 5 — learning tools

### [x] Flashcards / spaced repetition
Mark `Q: ... A: ...` blocks (or any paragraph with a special
annotation) as practice items. SM-2 scheduler. Review screen with
typed / multiple-choice / cloze modes. Huge draw for students and
researchers.

**Scope:** Medium. Scheduler is straightforward. UI is the work.

### [x] Highlighted study mode
`/read/highlights` (`$lib/highlights.ts`): ==marks== and PDF highlights
grouped by note with context, filter by text/tag, shuffle, a cloze quiz,
save as note.

### [x] Quiz generation
`generateQuizFromMemory(id)` in digest.ts: sends the memory's
content to the LLM, parses out Q/A JSON, and creates Flashcard
entities linked to the source.

---

## Tier 6 — ecosystem

### [x] Web clipper bookmarklet
Bookmarklet generated in Settings → Data. Captures page title, URL,
and selected text, opens Kurumi with content pre-filled via a
#/clip/<encoded> hash route. Hash router intercepts and creates a
memory. Web clipper utilities in src/lib/utils/web-clipper.ts.

### [x] Publish to web
"Publish as HTML" option in the memory detail export menu. Generates
a self-contained HTML file with inline CSS (dark/light auto-theme),
rendered markdown, title, date, tags. User downloads and hosts
anywhere. Published from src/lib/utils/publish.ts.

### [ ] Native mobile via Tauri / Capacitor
Wrap the PWA in Tauri Mobile or Capacitor for iOS/Android app-store
presence. DEFERRED — needs build tool config beyond the web app.

### [x] Share target on mobile
Web Share Target added to the PWA manifest (vite.config.ts). When the
installed PWA receives shared content, params land as query params on
/. The home page picks them up on mount and creates a memory.

### [x] Import from more sources
- Evernote ENEX: src/lib/utils/evernote-import.ts — XML parser that
  converts ENML content to markdown, preserves tags as #hashtags,
  handles en-todo checkboxes. Settings UI wired.
- Roam JSON: already shipped
- Markdown folder (Obsidian/Logseq/Bear/Notion/Foam): already shipped
- Apple Notes / Google Keep / Day One: DEFERRED

### [ ] Plugin / extension system
Explicit non-goal in the original roadmap. DEFERRED — needs
sandboxing infrastructure.

**Scope:** Very large. Sandboxing is the hard part. Deferred unless
community interest materializes.

---

## Tier 7 — infrastructure / quality (still genuinely open)

Moved from earlier "what's next" lists. These are thankless but real.

### [x] Vitest smoke tests
Critical paths only: undo stack push/pop, people/tag/topic merge +
restore, extraction pipeline, migration chain (v1 → v13).

### [x] CI + pre-commit hook
GitHub Actions running `svelte-check` + `build` on PR.  `.husky`
pre-commit running the same locally. Locks in the `0 errors / 0
warnings` invariant.

### [x] Performance audit
Measured on the production build (2026-11-08, first visit, raw bytes):
home page JS 790 KB → 387 KB, /read 308 KB, /actions 396 → 315 KB; first
paint ~200 → ~140 ms. Fixes: isomorphic-git loads on first git sync
(`gitService()` in sync/service.ts; eager code imports `$lib/git/status`,
not the `$lib/git` barrel), JSZip on first export, the split pane (and
with it the editor) when opened, the agent pane when opened, the command
palette while idle; `databaseBlockViewId` moved to `$lib/database` so
Read mode doesn't pull in ProseMirror. Left alone: the Automerge wasm
(3.5 MB raw, the database itself) and the ONNX runtime wasm, which the
build emits twice (2 × 21.8 MB) but nothing precaches; only deploy size.

### [~] Realtime API verification
2026-11-08, checked against the current docs: the client was written for
the beta interface (preview model, SDP to /v1/realtime?model=…, beta
session fields, `response.audio_transcript.*` events), so the assistant's
words would never have shown. Migrated to GA: client secret minted in the
browser (/v1/realtime/client_secrets, carries the session config), WebRTC
call at /v1/realtime/calls, `gpt-realtime`, GA event names (beta names
still read). Event handling is a pure function with unit tests on the GA
shapes; both endpoints answer browser requests (CORS ok). Left: one live
run, `OPENAI_API_KEY=… npm run test:live` (connects with a fake mic), and
a spoken conversation.

### [~] LLM recurrence extraction verification
`npm run test:live` runs the real provider and prompt on daily / weekly /
monthly / one-off phrases and checks `recurrence`. Needs a key to run
(none on the machine this was written on).

### [~] Periodic background sync verification
The handler is now tested (e2e/pwa.mjs): with the app's tab closed,
DevTools fires `periodicsync` and the worker shows the due to-do's
notification from its cache. Registration (`ensurePeriodicSyncRegistered`)
can't be tested headless: Chrome keeps the permission denied unless the app
is installed with enough engagement. Still needs one check on an installed
Chrome/Android app: chrome://serviceworker-internals lists the tag.

### [x] Mobile device CSS audit (emulated)
2026-11-08: all 46 routes (example vault, Labs on) at 390×844 with touch,
checked for page overflow, elements past the edge and small tap targets,
plus screenshots of each. No route overflows. Fixed: to-do rows (text sat
on its own line under the checkbox), editor tables (columns squeezed to a
letter each; now scroll), question rows (text squeezed by the actions),
the Vim switch (the 44px touch minimum made it a circle), the Read
breadcrumb root (22px wide). Still worth a pass on a real phone (iOS
Safari keyboard, safe areas), which emulation can't show.

---

## Explicitly deferred (as of 2026-04-09)

- **Multi-user real-time collaboration** — explicit non-goal in
  original roadmap. Automerge makes it technically feasible but the
  product surface it'd require (comments, presence, permissions,
  invites) is a different app.
- **Entity schema plumbing** — redundant with the existing
  per-type merge flows (/people, /tags, /topics).
- **Heavy plugin ecosystem** — waiting for community interest
  before committing to the sandboxing work.

---

## Strategic recommendation

If the goal is **"Kurumi feels as capable as Notion/Obsidian, plus has
something they don't have"** — pick three:

1. **Slash commands + rich blocks** (editor parity)
2. **Dataview-style inline queries + saved search views** (structured data)
3. **Agentic chat pane with tool use** (AI differentiator)

These three together would take Kurumi from "great solo PKM app" to
"AI-native PKM tool you couldn't build without Claude-tier models."
Everything else is polish.

If the goal is **"ship one thing that most changes the feel of the
app"** — **slash commands alone**. It's the single change that makes
the editor feel as capable as Notion's, and it sets up every future
feature (every new block type, every command, every AI action) as
"just another slash entry."
