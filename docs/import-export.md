# Import & export

Everything in Kurumi can leave as plain files, and most other note apps'
exports can come in. Imports and exports live in **Settings → Data**.

## Import

| From | What to pick | What you get |
|------|--------------|--------------|
| **Notion** | In Notion: Settings → *Export all workspace content* (or a page's ⋯ → *Export*), format **Markdown & CSV**, with subpages. Pick the `.zip` | Pages nested as folders, page links as `[[wikilinks]]`, images and files stored with the notes. Database tables are skipped (their rows come in as pages) |
| **A Markdown folder**: Obsidian, Logseq, Bear, Foam, … | The folder | Subfolders as folders, notes with their frontmatter tags |
| **Roam Research** | The JSON export | One note per page, outlines as nested bullets, `{{TODO}}` / `{{DONE}}` as checkboxes |
| **Evernote** | An `.enex` export | Notes as Markdown, tags as `#hashtags` |
| **Kurumi** | A JSON backup | Everything; if vaults clash you choose to overwrite, duplicate or skip them |

Imports land in the current vault (a backup restores its own vaults).
Large imports are saved in one go, so they don't slow the app down while
they run.

Also: opening a `.md` file with the installed app, sharing into Kurumi,
and the web clipper (see [Capture](capture.md#from-other-apps)).

## Export

| Export | Where | Contains |
|--------|-------|----------|
| **JSON backup** | Settings → Data → *Export* | Every vault, folder, note, person, to-do and record. Restores with *Import* |
| **Markdown** | Settings → Data → *Export as Markdown* | A ZIP of `.md` files in your folder structure, for **this vault** or **all vaults** (one folder each). Front matter with tags, people, dates; transcripts, summaries, to-dos and open questions included. Images, recordings and attachments go into `assets/` and are linked relatively |
| **Hugo / Zola** | Same, choose the format | The same Markdown, with front matter shaped for that static site generator |
| **One note** | The note's ⋯ menu | Download as Markdown, a self-contained HTML page, copy as rich text, or share |
| **People, events, tags** | References → download | vCard (`.vcf`), calendar (`.ics`), CSV |
| **A chat** | Agent pane | The conversation as Markdown |

A JSON backup is the complete one. The Markdown export is for reading
and for other tools; importing it back gives you the notes but not the
to-dos, projects and other records.

For a continuously updated Markdown copy instead of a download, use the
local folder [sync](sync.md#local-folder--sync-agent).
