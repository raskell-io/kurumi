# Architecture

Kurumi is a static web app. There is no backend: the browser holds the
data, does the work, and talks directly to the sync storage and AI
providers you configure.

```
┌──────────────────────────────────────────────────────────────┐
│ UI: SvelteKit 2 + Svelte 5 runes, Milkdown editor, Tailwind 4  │
├──────────────────────────────────────────────────────────────┤
│ Stores ($lib/stores, $lib/db): derived views of the document   │
│ Search: MiniSearch (keywords) + embeddings (meaning)            │
│ Inference router: on-device providers first, remote fallback   │
├──────────────────────────────────────────────────────────────┤
│ One Automerge document (schema v17)                            │
├──────────────────────────────────────────────────────────────┤
│ IndexedDB: snapshot + change chunks · blobs · embeddings ·     │
│ model cache          localStorage: per-device settings          │
├──────────────────────────────────────────────────────────────┤
│ Service worker: offline app shell, share target, notifications │
├──────────────────────────────────────────────────────────────┤
│ Sync: Kurumi server (Worker + R2) · S3 · WebDAV · Azure ·      │
│ Git (isomorphic-git) · local folder (+ agent with system git)  │
└──────────────────────────────────────────────────────────────┘
```

## Local-first

| | Cloud-first apps | Kurumi |
|---|---|---|
| Where data lives | The provider's servers | Your device |
| Offline | Limited | Everything except remote AI |
| Speed | Network round trips | Local reads and writes |
| Sync | Their service | Storage you pick, or none |
| Leaving | Export, if offered | Plain Markdown and JSON, any time |

## The document

Everything, across all vaults, is one [Automerge](https://automerge.org/)
document (`KurumiDocument` in `src/lib/db/types.ts`). Its main
collections, each a map from id to record:

| Collection | Holds |
|------------|-------|
| `memoryObjects` | Every capture: notes, voice memos, meetings, files, references. Distinguished by `type` |
| `folders`, `vaults` | The tree and the separate workspaces |
| `people`, `events`, `templates` | `@mentions`, `//dates`, note templates |
| `actionItems` | To-dos (*To-dos* in the UI) |
| `reminderProposals`, `draftProposals` | AI suggestions waiting for review |
| `projects`, `decisions`, `questions`, `meetingSeries` | The [Work](work.md) records |

Migrations in `src/lib/db/store.ts` raise the schema version (now 17) as
the document gains fields.

## Persistence

`saveDoc` writes a full snapshot (`kurumi-doc`) plus small incremental
change chunks (`kurumi-doc-changes`). Saves are coalesced, and chunks are
folded into a new snapshot when the app is idle, when they pile up, and
a few seconds after start. Files (images, audio, attachments) live in a
separate blob store and are referenced from notes as `blob:<id>`.

Note text is written as a diff (`Automerge.updateText`), never by
assigning a new string: with autosave, assigning stored a full copy of
the note at every pause in typing, and load time grew with it.

### Optimized vaults

A long-lived vault accumulates character-level history, and loading
replays it (about 0.65 s per million characters). [Optimizing](offline.md#optimize-a-big-vault)
rebuilds the document as a fresh history (`doc.epoch`) with long text
fields stored as plain immutable strings (`textFormat: 'plain'`). The
document records the oldest app version that can read it
(`minAppVersion`); older apps refuse it and ask to update.

## Merging

`mergeDoc` combines a copy from sync with the local one:

- **Same history:** an Automerge merge. Concurrent edits interleave;
  conflicting single values resolve the same way on every device.
- **Different histories** (two devices used before sync existed, or one
  side optimized): the newer epoch wins, and every record from the other
  side is merged in by `mergeRecords`: union by id, newer timestamp wins,
  across every collection.

Git sync adds a layer on top: notes round-trip through Markdown, and a
note changed on both sides since the last sync opens a side-by-side
conflict dialog. The [local agent](../agent/README.md) registers a git
merge driver that merges the database file the same way and parks
unrelated histories for the app to merge.

## Encryption

Optional, for the object-storage methods: AES-256-GCM with a key from
PBKDF2 over a passphrase. See [End-to-end encryption](encryption.md).

## Inference

Providers (`src/lib/inference/providers/`) implement one interface
(transcribe, summarize, summarize a meeting, extract entities, propose
reminders and drafts, answer with context, speak) and advertise what they
can do. The router asks them in order: on-device Whisper and text model,
OpenAI, OpenAI-compatible providers, on-device speech. Embeddings run in
a Web Worker. See [AI](ai.md).

## Offline app

`@vite-pwa/sveltekit` generates a Workbox service worker that precaches
the app. `static/sw-notify.js` is imported into it for the share target,
notification actions, periodic due checks and the app badge. New versions
wait for the user's *Reload*. See [Offline & storage](offline.md).

## Sync server

`worker/` is a Cloudflare Worker: a setup page, a one-time claim that
creates a token (stored hashed), and `GET`/`PUT /sync` for the database
and `?key=` blobs in R2. See [Your own sync server](sync-server.md).

## Why these choices

- **Automerge:** devices merge without a central server, and offline
  edits never conflict at the data level.
- **SvelteKit + static hosting:** small bundles (the app also loads ML
  models), and nothing to operate.
- **Sync through storage you own:** no Kurumi service to trust or pay
  for; git keeps notes readable and grep-able.
- **An inference router:** local first, remote as fallback, without the
  features knowing which one ran.
