# Kurumi folder: guide for coding agents

This folder is a mirror of the user's [Kurumi](https://github.com/raskell-io/kurumi)
vault, their personal memory: notes, meetings, to-dos, people, projects. You can
read it to answer questions and change it by editing files here, without Kurumi's
interface.

Kurumi writes this file on every sync; edits to it are overwritten.

## What to use when

| The user or the work calls for… | Use | Why |
|---|---|---|
| Knowledge worth keeping: findings, a summary, a write-up | **Note** | Searchable and linkable; what they'll recall later |
| Something that happened on a given day, a passing log entry | **Daily note** | One running note per day, instead of many small ones |
| Something the user asked to have tracked or done | **To-do** | Shows on the to-do list and on the day it's due |
| Something *you* noticed that they might want to follow up | **Reminder proposal** | They approve or reject it, and only then does it become a to-do |
| An email or invite that should go out | **Draft proposal** | They review and send it themselves. Kurumi sends nothing |
| A choice that was made, and the reason for it | **Decision** | The log people check later for why something is the way it is |
| Something unknown that needs an answer | **Question** | Stays visible as open until it's answered |
| A body of work with several notes, to-dos or decisions | **Project** | Ties them together on one page |
| A recurring meeting, or a point for the next one | **Meeting** + agenda item | The next meeting's note starts from its agenda |
| Someone who comes up by name and matters | **Person** | Gives them a page: contact details, what's waiting on them |
| A dated appointment with details (time, place, people) | **Event** | For a date alone, `//2026-11-20` in a note is enough |
| Note structure the user will repeat | **Template** | Used when they create a note from it |
| An image, a recording, a PDF | **Blob**, referenced from a note | Stays with the note on all their devices |

Before you add anything:

- **It's the user's memory, so stay in scope.** Add what they asked for or would
  clearly want. Don't log your own working steps, and don't file a to-do for
  every thought.
- **Ask or propose when you're guessing.** If they told you to, act. If you
  inferred it, use a proposal, which leaves the decision with them.
- **Search first.** Look through the `.md` files and `metadata.json` for an
  existing note, person, project or tag. Reuse names exactly as written: `Dana
  Reyes` and `Dana` become two people. Extend what's there before creating more.
- **Link things.** Set `memoryObjectId` / `memoryId` to the note something came
  from and `projectId` to its project, so the user can trace it.
- **Keep to their language and structure.** Follow how existing notes are written
  and filed, and tell the user what you added.

## Rules

- Never touch `kurumi-sync.bin` or `kurumi-sync.incoming-*.bin`. They are the
  binary database.
- Never edit `noteIds`, `notes` or `vault` in `metadata.json`. They are
  regenerated.
- Write files as UTF-8. On Windows PowerShell 5, `Out-File` and `>` write
  UTF-16: use `Set-Content -Encoding utf8` or a script instead.
- Keep `metadata.json` valid JSON. While it isn't, Kurumi neither reads nor
  overwrites it, and tells the user.
- To delete something, mark it (see below). Removing a file or a record does
  nothing: Kurumi writes it back, so that an unmounted disk or a bad merge
  can't delete anything.
- Kurumi never deletes a file. When a file has to go (a note renamed in the app,
  say), it moves to `.kurumi/archive/` first. That's where to look for anything
  that seems to have disappeared.

## Which setup is this?

| You see | Setup | How your change reaches Kurumi |
|---------|-------|--------------------------------|
| `kurumi-sync.bin` at the top | Local folder | Save the files. |
| No `kurumi-sync.bin` | Git sync | Commit and push. Kurumi reads them at its next pull. |

A local folder may also be a git checkout run by the Kurumi sync agent. You
don't need to commit there, the sync agent does.

**Local folder:** while Kurumi is open it looks for changes every few seconds
and picks yours up within about 15 seconds, and it writes its own changes here
just as quickly. You can work at the same time as the user: Kurumi doesn't
overwrite a file that changed after it read it, and takes it next time. Closed,
it catches up the next time it opens, once the browser has permission for the
folder (that can take one click on *Sync now*).

Kurumi rewrites a note's frontmatter when its dates change, so read a file
again before editing it if some time has passed.

## Layout

Single vault (`<v>` is the top of this folder):

```
kurumi-sync.bin
.kurumi/metadata.json   vault id, folders, records (see below)
.kurumi/blobs/<id>      images, audio and other files
projects/roadmap.md     one markdown file per note; directories are folders
```

All vaults (`.kurumi/vaults.json` maps vault id to directory): the same
structure once per vault, with `<v>` being `work/`, `personal/`, and so on.
Each has its own `.kurumi/metadata.json` and `.kurumi/blobs/`. Always use the
`metadata.json` and `blobs/` of the vault you are adding to.

## Ids and timestamps

- Ids are letters and digits only, about 16 of them, for example from
  `node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"`.
- Timestamps in `metadata.json` are milliseconds since the epoch:
  `node -e "console.log(Date.now())"`, in PowerShell
  `[DateTimeOffset]::Now.ToUnixTimeMilliseconds()`, in a Unix shell
  `date +%s000`. Git sync needs them correct: there, an edit only applies if
  its stamp is newer. In a local folder Kurumi compares contents.

## Notes

Create `<v>/some-dir/my-note.md`:

```markdown
---
id: 3f9a1c7e5b2d4a60
name: "My note"
created: 2026-11-05T09:30:00.000Z
modified: 2026-11-05T09:30:00.000Z
tags: ["planning", "q4"]
---
The body is Markdown.

- [ ] Task lists work
- A link to another note: [[Roadmap]], embedded: ![[Roadmap]]
- A person: @Dana Reyes, a date: //2026-11-20
```

- `name` is the title, and the file is named after it. Notes with the same title
  in one folder get separate files, the newer with its id added.
- The file name should be the slugged title (`my-note.md`). In a local folder
  Kurumi renames it to that if it isn't.
- Frontmatter is deliberately simple: `---` on the very first line (LF line
  endings for git sync), one `key: value` per line, tags inline as above (no YAML block lists).
- Links: `[[Title]]`; `[[Title|shown text]]` shows other text, `[[Title#Heading]]`
  points at a heading, `[[Title#^a1b2c3]]` at the block ending in ` ^a1b2c3` (keep
  such ids when you edit). `![[Title#Heading]]` embeds a section. In a table,
  escape the bar: `[[Title\|text]]`.
- Columns: `::::columns`, then `:::column` … `:::` for each, then `::::`.
- Math: `$x^2$` inline, `$$` on their own lines around a block of LaTeX. A `$` with a
  space after it or a digit after the closing one stays text, so prices are safe.
- A new directory becomes a folder. With all vaults on, a new top-level
  directory becomes a new vault.
- Git sync: always set `id`, and use slugged names for files and directories
  (`client-x/kickoff.md`). Kurumi doesn't remove the original there, so any
  other name leaves a second copy of the file behind.

**Daily notes** are ordinary notes named `Daily • YYYY-MM-DD`, in the file
`daily-YYYY-MM-DD.md` at the top of the vault. Append to the day's note if it
exists, otherwise create it.

**Tags** are the `tags` list of a note; reuse existing ones. **Folders** are
directories. **Finding a note's id:** its frontmatter, or `noteIds` in
`metadata.json` (path to id).

To edit a note in a local folder, change its body, `tags`, `name` or emoji
`icon`. Keep the frontmatter if you can. A file rewritten without it still
updates that note, and keeps its title and tags. An emptied file is ignored.
Writing a different `id` to an existing path makes a new note. To move it, move the file. To delete it (to the Trash), add
`deleted: true` to its frontmatter. If the note was edited in the app at the
same time, the two are merged where they touch different lines. If you changed
the same lines, the app's text stays on the note and yours becomes a new note
titled "… (edit from folder)", so nothing is lost.

With git sync, change the body, `tags` or `name` and update `modified` to now.
Moving and `deleted` are local folder only.

## Images, audio and files

1. Copy the bytes to `<v>/.kurumi/blobs/<id>`. The file name is the bare id,
   with no extension and no dots.
2. Record the type in `metadata.json`:

   ```json
   { "blobs": { "blob:9c2e4f1a7d3b8e50": { "mimeType": "image/png" } } }
   ```

3. Reference it from a note, in a new file or an existing one. A blob no note
   refers to isn't kept by the next device.

```markdown
![Whiteboard photo](blob:9c2e4f1a7d3b8e50)
![audio:Standup recording](blob:7a1d3e9f2c6b4a80)
[report.pdf](blob:5e8b2f4a9d1c7e30)
```

Image, audio (`![audio:…]`) and attachment link, in that order. Use `blob:`
references rather than relative paths, which only work on this computer.

## Records in metadata.json

Add entries to the sections shown, leaving everything else as it is.
`vaultId` is always `vault.id` from the same file. Fields in these examples
that you leave out get the neutral default (null, empty, `open`). The ones
that are required are the id, the two timestamps, and: `text` for to-dos,
decisions, questions and reminder proposals; `name` for people, projects,
meetings and templates; `date` for events; `subject` for draft proposals;
`content` for templates; `memoryObjectId` and, for reminders, `suggestedDate`
for proposals. Proposals only have `createdAt`, no `updatedAt`. A record missing one of them is dropped.

Dates like `dueDate` are `YYYY-MM-DD`.

### To-dos (`actionItems`, keyed by id)

```json
{
  "actionItems": {
    "a41c9e07d2b8f365": {
      "id": "a41c9e07d2b8f365",
      "text": "Send the Q4 plan to Dana",
      "status": "open",
      "dueDate": "2026-11-20",
      "assignee": null,
      "recurrence": "none",
      "memoryObjectId": null,
      "projectId": null,
      "confidence": 1,
      "vaultId": "default",
      "createdAt": 1793870000000,
      "updatedAt": 1793870000000
    }
  }
}
```

- `status`: `open`, `in_progress`, `done` or `cancelled`.
- `recurrence`: `none`, `daily`, `weekly`, `monthly` or `yearly`.
- `assignee`: null means the user. A person's name makes it "waiting for".
- `memoryObjectId`: id of the note it came from.
- Ids starting with `nt-` are checkbox lines in a note (`- [ ] Text @Name //YYYY-MM-DD`):
  the app keeps them in step with the line, so change the line in the note's `.md` file
  (tick it, edit it, remove it), not the record. To add a to-do that belongs to a note,
  add a `- [ ]` line to it.

To change an existing record, edit it and set `updatedAt` (`modified` for
people and events) to now. To delete any record, add `"deleted": true` to it
(local folder only). If the app changed the same record too, changes to
different fields both apply; for the same field, the newer timestamp wins.

### People and events (`people`, `events`, keyed by id)

These two use `created` and `modified` as their timestamps.

```json
{
  "people": {
    "b72e1d94c06a3f58": {
      "id": "b72e1d94c06a3f58",
      "name": "Dana Reyes",
      "email": "dana@example.com",
      "company": "Example Co",
      "title": "CTO",
      "vaultId": "default",
      "created": 1793870000000,
      "modified": 1793870000000
    }
  },
  "events": {
    "c83f2ea5d17b4069": {
      "id": "c83f2ea5d17b4069",
      "date": "2026-11-20",
      "title": "Q4 planning",
      "time": "14:00",
      "duration": "1h",
      "location": "Room 2",
      "attendees": ["Dana Reyes"],
      "vaultId": "default",
      "created": 1793870000000,
      "modified": 1793870000000
    }
  }
}
```

### Projects, decisions, questions, meetings, proposals, templates (`work`, each a list)

Updating these is as useful as adding them: when you finish a to-do, set it to
`done`; when a question gets answered, set `status`, `answer` and `resolvedAt`;
to raise something for the next meeting, add to its `agenda`.

```json
{
  "work": {
    "projects": [
      {
        "id": "d94a3fb6e28c5170",
        "name": "Q4 plan",
        "status": "active",
        "owner": null,
        "dueDate": "2026-12-15",
        "description": "",
        "vaultId": "default",
        "createdAt": 1793870000000,
        "updatedAt": 1793870000000
      }
    ],
    "decisions": [
      {
        "id": "e05b4ac7f39d6281",
        "text": "Ship the mobile app first",
        "rationale": "Most usage is on phones",
        "decidedOn": "2026-11-05",
        "decidedBy": ["Dana Reyes"],
        "memoryId": null,
        "projectId": "d94a3fb6e28c5170",
        "vaultId": "default",
        "createdAt": 1793870000000,
        "updatedAt": 1793870000000
      }
    ],
    "questions": [
      {
        "id": "f16c5bd8a40e7392",
        "text": "Who owns the migration?",
        "status": "open",
        "assignee": null,
        "answer": "",
        "answerMemoryId": null,
        "memoryId": null,
        "projectId": "d94a3fb6e28c5170",
        "resolvedAt": null,
        "vaultId": "default",
        "createdAt": 1793870000000,
        "updatedAt": 1793870000000
      }
    ],
    "meetingSeries": [
      {
        "id": "a27d6ce9b51f8403",
        "name": "Weekly with Dana",
        "people": ["Dana Reyes"],
        "cadence": "weekly",
        "projectId": "d94a3fb6e28c5170",
        "agenda": [
          { "id": "b38e7dfa062c9514", "text": "Review Q4 plan", "addedAt": 1793870000000, "meetingId": null }
        ],
        "vaultId": "default",
        "createdAt": 1793870000000,
        "updatedAt": 1793870000000
      }
    ],
    "reminderProposals": [
      {
        "id": "c49f8e0b173da625",
        "memoryObjectId": "3f9a1c7e5b2d4a60",
        "text": "Follow up with Dana about the Q4 plan",
        "suggestedDate": "2026-11-20",
        "reason": "Dana promised a reply by the 20th",
        "confidence": 0.8,
        "recurrence": "none",
        "status": "pending",
        "decidedAt": null,
        "actionItemId": null,
        "vaultId": "default",
        "createdAt": 1793870000000
      }
    ],
    "draftProposals": [
      {
        "id": "d50a9f1c284eb736",
        "memoryObjectId": "3f9a1c7e5b2d4a60",
        "kind": "email",
        "target": "Dana Reyes",
        "subject": "Q4 plan",
        "body": "Hi Dana, here's the plan we discussed.",
        "suggestedDate": null,
        "suggestedTime": null,
        "confidence": 0.8,
        "status": "pending",
        "decidedAt": null,
        "vaultId": "default",
        "createdAt": 1793870000000
      }
    ],
    "templates": [
      {
        "id": "e61ba02d395fc847",
        "name": "Incident review",
        "content": "# {title}\n\nDate: {date}\n\n## What happened\n",
        "description": "After something went wrong",
        "vaultId": "default",
        "created": 1793870000000,
        "modified": 1793870000000
      }
    ]
  }
}
```

- Project `status`: `active`, `paused`, `done` or `archived`.
- Question `status`: `open`, `answered` or `dropped`.
- Meeting `cadence`: `weekly`, `biweekly`, `monthly` or `none`.
- `memoryId` is the note a decision or question came from.
- Proposals need `memoryObjectId`, the note they came from, so write that note
  first. Leave their `status` at `pending`: approving is the user's decision, and
  only approving in the app creates the to-do. Draft `kind`: `email` or
  `calendar-event`.
- Templates use `created` and `modified`, and placeholders like `{title}`,
  `{date}` and `{weekday}`.

### Databases (`work.databaseViews`)

A database is a folder shown as a table, board, gallery or calendar: its notes
are the rows. A view names the folder (`folderId`, from `folders`) and the
properties its rows have. All views of one folder share the same `properties`.

```json
{
  "work": {
    "databaseViews": [
      {
        "id": "f72cb13e4a6d9058",
        "name": "Reading list",
        "folderId": "8b1e4c2a9f3d7065",
        "viewType": "table",
        "columns": [
          { "field": "title", "visible": true },
          { "field": "prop:status", "visible": true }
        ],
        "properties": [
          { "key": "status", "label": "Status", "type": "select", "options": ["To read", "Reading", "Done"] }
        ],
        "sortField": "updatedAt",
        "sortDirection": "desc",
        "groupField": "prop:status",
        "filterQuery": "",
        "vaultId": "default",
        "createdAt": 1793870000000,
        "updatedAt": 1793870000000
      }
    ]
  }
}
```

- `viewType`: `table`, `list`, `board` (grouped by `groupField`), `gallery`,
  `calendar` or `timeline` (`dateField`, optional `endDateField`).
- Property `type`: `text`, `number`, `date` (`YYYY-MM-DD`), `select`,
  `multiSelect`, `checkbox`, `url`, `person`, `relation` (`relationTo`: a folder
  id; values are note ids), `rollup` or `formula` (computed, never stored).
- A note's body can show a database: a ```` ```database ```` block with `view: <id>`.
- The rows' values are under `notes.<id>.customProps` (by property `key`), which
  you can read but not change: set them in the app.

## Not available from files

- Links from a note to a project. Link from the other side: set `projectId` on
  a to-do, decision or question, and `memoryObjectId` / `memoryId` to the note.
- Canvases: a canvas note's body is JSON Canvas. Leave those files as they are.
- PDF highlights.
- Voice memos and meetings with transcripts: capture those in the app. A
  recording embedded in a note (`![audio:…]`) plays but isn't transcribed.
- Note icons on new notes, and favorites.
- Database property values (see Databases above).
- Labs features: flashcards, habits and saved searches.
- Vault settings, and encryption or sync settings.

## Check your work

After Kurumi has synced, look at the files again:

- Local folder: a record you added is still in `metadata.json`, with any
  missing fields filled in. If it's gone, a required field was missing.
- A new note has moved to its slugged file name and gained an `id` if it had
  none.
- A blob still listed under `blobs` with your mime type is in Kurumi.
- `.kurumi/rescued/` holds copies of changed files Kurumi had to replace without
  having taken in their content. Tell the user if anything appears there.
- If nothing changes, Kurumi may be closed or waiting for folder permission.
  Ask the user to look at Settings → Sync.
