# Kurumi documentation

Kurumi is a local-first second brain that runs in your browser. These
pages explain how to use it, how to sync it, and how it works inside.
The [project README](../README.md) is the short overview.

## Using Kurumi

| Guide | What's in it |
|-------|--------------|
| [Getting started](getting-started.md) | Install the app, find your way around, try the example vault, bring in your notes |
| [Capture](capture.md) | Notes, voice memos, meetings, files, photos, sharing from other apps, daily notes |
| [Editor](editor.md) | Markdown syntax, links, mentions, dates, tasks, embeds, slash commands, find & replace |
| [Organize & recall](organize-and-recall.md) | Vaults, folders, tags, people, search, Ask Kurumi, graph, read mode, references |
| [Work](work.md) | To-dos, projects, recurring meetings, decisions, open questions, proposals, inbox |
| [AI](ai.md) | On-device models, remote providers, the agent, voice, what leaves your device |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut, and how to change them |
| [Labs](labs.md) | Habits, flashcards, timeline and smart folders (off by default) |

## Your data

| Guide | What's in it |
|-------|--------------|
| [Sync](sync.md) | Every sync method, how to pick one, what happens when two devices edit |
| [Your own sync server](sync-server.md) | The Kurumi server on your free Cloudflare account, step by step |
| [End-to-end encryption](encryption.md) | Sync passphrase: how it works, adding devices, turning it off |
| [Offline & storage](offline.md) | Installing the app, updates, storage space, optimizing a big vault |
| [Import & export](import-export.md) | Notion, Obsidian, Roam, Evernote; markdown, Hugo, Zola, JSON backups |
| [Privacy & security](privacy-security.md) | Where your data lives, who can read it, what to watch out for |
| [Troubleshooting](troubleshooting.md) | Sync errors, a locked device, a slow start, an app that won't update |

## Inside Kurumi

| Guide | What's in it |
|-------|--------------|
| [Architecture](architecture.md) | The Automerge document, persistence, merging, the vault format |
| [Development](development.md) | Running locally, tests, CI, releases, project layout |
| [Sync agent](../agent/README.md) | Keep the vaults in any git repo using your machine's own git |
| [Sync server](../worker/README.md) | The Cloudflare Worker's routes and manual setup |
