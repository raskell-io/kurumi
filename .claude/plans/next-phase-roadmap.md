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
- Action items dashboard with inline edit / bulk ops / undo
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

### [ ] Columns / multi-column layout
Side-by-side content blocks. Moderate — Milkdown node that wraps N
children each constrained to a fraction of the width. DEFERRED.

### [x] Embeds (YouTube / Twitter / Figma / maps / PDF / image / audio)
YouTube URLs auto-convert to responsive iframes in read mode.
Other embed types can follow the same pattern.

### [x] Memory embeds (`![[title]]`)
`![[Title]]` renders as a linked preview card with title + summary.
Slash command `/memory-embed` inserts the syntax.

### [ ] Native inline-editable tables
Markdown tables with keyboard nav (Tab between cells), column add/
remove, sort, drag-to-resize. DEFERRED — GFM tables already render.

### [x] LaTeX math
`$inline$` and `$$block$$` rendered as styled monospace blocks.
Slash commands `/math-block` and `/math-inline`. Full KaTeX
rendering can be added as a future dep.

### [ ] Syntax-highlighted code blocks
Shiki or Prism integration inside Milkdown. Copy button, language
switcher. DEFERRED — needs external dep.

### [ ] Inline action items
`- [ ] text` lines inside any memory automatically become ActionItem
entities on save, linked back to the source memory with character
offsets. DEFERRED — needs editor integration.

### [ ] Callout-style AI suggestions
LLM-generated callouts that flag "this might be a duplicate of X" or
"consider linking to Y" inline in the editor while writing. DEFERRED.

---

## Tier 3 — agentic / AI-native differentiators

Where Kurumi surpasses rather than catches up to the incumbents.

### [x] Daily digest agent
Generates a note summarizing yesterday's captures, open action items,
and pending proposals with an LLM narrative summary. Triggered via
home page button or the agent chat's generate_daily_digest tool.

**Scope:** Small-medium. Needs the chat tool infra from Tier 1 OR a
simpler standalone scheduled job that writes a memory.

### [ ] Weekly review agent
Same pattern but weekly, writes to `/review` or a dedicated memory.
Integrates with the existing review page stats.

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

### [ ] Living notes ("evolving understanding")
A memory subtype that auto-updates as related content accumulates.
"My understanding of Topic X" gets rewritten by a background agent
whenever memories tagged/mentioning Topic X change significantly.
Version history kept.

**Scope:** Medium-large. Needs change-detection + throttled rewrite +
version tracking.

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

### [ ] Persistent agent memory
Chat conversations that remember across sessions (not just
within-turn). Each conversation gets its own memory thread with the
history.

**Scope:** Small. The data model is already memory-shaped.

### [ ] Multi-step agentic workflows
User defines a workflow in natural language ("every Monday morning:
scan last week's meetings, extract new action items, group by
project, write a summary to a new daily note, notify me"). The
scheduler runs it in the background.

**Scope:** Large. Workflow definition language, scheduler,
execution context, observability.

---

## Tier 4 — workspace & navigation polish

### [ ] Split-pane editor
Open multiple memories side-by-side. Obsidian-style draggable splits.
DEFERRED — needs significant editor state management.

### [x] Saved searches in the sidebar
Pin a filter query with a name. Data model: SavedSearch type in
KurumiDocument (v14→v15). Rendered in the sidebar above the folder
tree. CRUD in store.ts.

### [ ] Sticky notes bar
Pin memories you're currently working on. Persistent across sessions.
DEFERRED — tab bar covers the same use case.

### [ ] Search within a memory
Cmd+F inside the editor. Native browser search hits the whole page;
this scopes to the current memory's body. DEFERRED.

### [x] Outgoing links sidebar
Extracts [[wikilinks]] from the current memory and renders resolved
links in a section above backlinks on the read mode page.

### [ ] Bread-crumb navigation
Show folder path + recent memory trail at the top of the editor.
DEFERRED — mobile header already shows breadcrumbs.

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

### [ ] Highlighted study mode
Read mode variant that hides everything except highlighted passages
across all memories, stitched into a review document. DEFERRED.

### [x] Quiz generation
`generateQuizFromMemory(id)` in digest.ts: sends the memory's
content to the LLM, parses out Q/A JSON, and creates Flashcard
entities linked to the source.

---

## Tier 6 — ecosystem

### [ ] Web clipper browser extension
Chrome/Firefox extension: one-click save current page as a memory
with title + URL + selected text + screenshot. Simplest version is
a bookmarklet that POSTs to a local endpoint.

### [ ] Publish to web
Single memory or folder rendered as a public static page, hosted on
Cloudflare Pages or Netlify via a one-click deploy. Includes a
"Published" badge on the memory with the URL.

### [ ] Native mobile via Tauri / Capacitor
Wrap the PWA in Tauri Mobile or Capacitor for iOS/Android app-store
presence. Unlocks share-target, background notifications, proper PWA
install.

### [ ] Share target on mobile
Receive shared content from other apps (text, images, URLs, files)
directly into Kurumi as a new memory.

### [ ] Import from more sources
- Evernote ENEX
- Apple Notes
- Bear (already works via markdown folder)
- Email forwarding (dedicated address → memory)
- Google Keep
- Day One

### [ ] Plugin / extension system
Explicit non-goal in the original roadmap, but worth reconsidering at
this feature depth. Sandboxed JS plugins with a defined API for: new
block types, new inference providers, new sidebar panels, new
command-palette entries, new memory types.

**Scope:** Very large. Sandboxing is the hard part. Deferred unless
community interest materializes.

---

## Tier 7 — infrastructure / quality (still genuinely open)

Moved from earlier "what's next" lists. These are thankless but real.

### [ ] Vitest smoke tests
Critical paths only: undo stack push/pop, people/tag/topic merge +
restore, extraction pipeline, migration chain (v1 → v13).

### [ ] CI + pre-commit hook
GitHub Actions running `svelte-check` + `build` on PR.  `.husky`
pre-commit running the same locally. Locks in the `0 errors / 0
warnings` invariant.

### [ ] Performance audit
Bundle size analysis, lazy-loading opportunities, initial-paint
profiling. The bundle has grown a lot.

### [ ] Realtime API verification
Untested feature shipped against documentation alone. Needs exercise
against a live OpenAI key to confirm the event-handling code handles
all the actual event shapes.

### [ ] LLM recurrence extraction verification
Untested: the `proposeReminders` prompt asks GPT-4o-mini to detect
"every week" style phrases. Need to verify the model actually
populates the `recurrence` field in real extractions.

### [ ] Periodic background sync verification
Only works when PWA is installed on Chromium. Needs real-device
testing.

### [ ] Mobile device CSS audit
~12 new routes added without phone testing. Probably has overflow /
touch-target issues. Static audit possible, real device preferred.

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
