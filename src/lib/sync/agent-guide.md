# Kurumi folder: guide for coding agents

This folder is a mirror of a [Kurumi](https://github.com/raskell-io/kurumi)
vault. You can add notes, images, files, to-dos, people, events, projects,
decisions, questions and meetings by editing files here. Kurumi picks them up
on its next sync, so nothing has to be done in its web interface.

Kurumi writes this file on every sync; edits to it are overwritten.

## Rules

- Never touch `kurumi-sync.bin` or `kurumi-sync.incoming-*.bin`. They are the
  binary database.
- Never edit `noteIds`, `notes` or `vault` in `metadata.json`. They are
  regenerated.
- Don't rename, move or delete note files, and don't remove records from
  `metadata.json`. Kurumi doesn't read those as changes and writes the
  originals back. Ask the user to do it in the app.
- To finish a to-do, set its status (see below) rather than removing it.
- Keep `metadata.json` valid JSON. An unparseable file is ignored and then
  overwritten, which loses your additions.

## Which setup is this?

| You see | Setup | How your change reaches Kurumi |
|---------|-------|--------------------------------|
| `kurumi-sync.bin` at the top | Local folder | Save the files. Kurumi reads them at its next sync. |
| No `kurumi-sync.bin` | Git sync | Commit and push. Kurumi reads them at its next pull. |

A local folder may also be a git checkout run by the Kurumi sync agent. You
don't need to commit there, the sync agent does.

Kurumi only syncs while it is open: when it starts, when its tab comes back
into view, a few seconds after an edit in the app, or from the sync button.
Nothing happens until then, so tell the user if they need to see the result
right away.

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

- Ids are letters and digits only: `openssl rand -hex 8`.
- Timestamps in `metadata.json` are milliseconds since the epoch:
  `date +%s000`. Take the time when you write the file, not earlier. A new
  record stamped before Kurumi's last sync is treated as one the user deleted
  and is dropped, and an edited record only applies if its stamp is newer.

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

- `name` is the title. Pick one no other note in the folder uses: the file is
  named after it, so two notes with the same title share one file.
- The file name should be the slugged title (`my-note.md`). In a local folder
  Kurumi renames it to that if it isn't.
- Frontmatter is deliberately simple: LF line endings, `---` on the very first
  line, one `key: value` per line, tags inline as above (no YAML block lists).
- Links have no alias form: `[[Title]]`, never `[[Title|text]]`.
- A new directory becomes a folder. With all vaults on, a new top-level
  directory becomes a new vault.
- Git sync: always set `id`, and use slugged names for files and directories
  (`client-x/kickoff.md`). Kurumi doesn't remove the original there, so any
  other name leaves a second copy of the file behind.

To edit a note, change its body or `tags` and update `modified` to now. Only
those are read back. If the note was also edited in the app since the last
sync, the app's version wins and your edit is overwritten. A title change has
to be made in the app.

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
decisions and questions; `name` for people, projects and meetings; `date` for
events. A record missing one of them is dropped.

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

To change an existing record, edit it and set `updatedAt` (`modified` for
people and events) to now.

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

### Projects, decisions, questions, meetings (`work`, each a list)

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
    ]
  }
}
```

- Project `status`: `active`, `paused`, `done` or `archived`.
- Question `status`: `open`, `answered` or `dropped`.
- Meeting `cadence`: `weekly`, `biweekly`, `monthly` or `none`.
- `memoryId` is the note a decision or question came from.

## Not available from files

- Links from a note to a project. Link from the other side: set `projectId` on
  a to-do, decision or question, and `memoryObjectId` / `memoryId` to the note.
- Voice memos and meetings with transcripts: capture those in the app. A
  recording embedded in a note (`![audio:…]`) plays but isn't transcribed.
- Reminder and draft proposals, templates, and note icons on new notes.

## Check your work

After Kurumi has synced, look at the files again:

- Local folder: a record you added is still in `metadata.json`, with any
  missing fields filled in. If it's gone, it was dropped (a required field
  missing, or a stamp older than the last sync). Add it again with a fresh
  timestamp.
- A new note has moved to its slugged file name and gained an `id` if it had
  none.
- A blob still listed under `blobs` with your mime type is in Kurumi.
