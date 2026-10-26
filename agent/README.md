# kurumi-agent

Sync your Kurumi vaults with a git remote (GitHub, GitLab, Codeberg, a
company GitHub Enterprise, …) **from outside the browser**, using your
machine's own `git` and credentials.

```
Kurumi (browser) ──writes──▶ ~/kurumi-notes ◀──commit / pull / push──▶ kurumi-agent ──▶ GitHub
                 ◀──reads───   (local folder)
```

Kurumi's built-in Git sync runs inside the browser, so it needs a personal
access token stored in the browser and a CORS proxy. At work that's often
not an option. With the agent:

- the browser only reads and writes a folder on disk (Settings → Sync → Local);
- the agent commits that folder and pulls/pushes it with the system `git`,
  so SSH keys, credential helpers and SSO work as they do for any repo;
- no token or proxy is involved, and the repo stays plain markdown you can
  browse and grep.

## Requirements

- Node.js 20+ and git
- Chrome or Edge for Kurumi (the folder access uses the File System Access API)
- `npm install` run once in the Kurumi checkout (the merge driver uses
  `@automerge/automerge`), or `npm install` inside `agent/` if you copy
  this folder elsewhere

## Setup

1. **Create an empty repo** on GitHub (private is a good idea), e.g.
   `git@github.com:you/kurumi-notes.git`.

2. **Create the local folder from it:**

   ```bash
   node agent/kurumi-agent.mjs init ~/kurumi-notes --remote git@github.com:you/kurumi-notes.git
   ```

   This clones (or `git init`s an existing folder), registers the merge
   drivers and commits a `.gitattributes`. On a second computer, run the
   same command; it clones what's already there.

3. **Point Kurumi at it:** Settings → Sync → Primary method **Local** →
   choose `~/kurumi-notes`. Turn on **Write all vaults** so every vault gets
   its own subfolder. Press **Sync now** once.

4. **Run the agent**, either on demand:

   ```bash
   node agent/kurumi-agent.mjs sync ~/kurumi-notes
   ```

   or continuously:

   ```bash
   node agent/kurumi-agent.mjs watch ~/kurumi-notes            # commit 10s after changes, pull every 5 min
   node agent/kurumi-agent.mjs watch ~/kurumi-notes --interval 120 --debounce 30
   ```

   Changes the agent pulls in are picked up by Kurumi on its next sync
   (automatic while the app is open, or press **Sync now**).

5. **Optional: start it automatically.** Instead of keeping `watch` in a
   terminal, install it as a background service that starts at login and
   restarts if it stops:

   ```bash
   node agent/kurumi-agent.mjs install-service ~/kurumi-notes             # pull every 5 min
   node agent/kurumi-agent.mjs install-service ~/kurumi-notes --dry-run   # show what it would do
   node agent/kurumi-agent.mjs uninstall-service ~/kurumi-notes
   ```

   On macOS this is a LaunchAgent (`~/Library/LaunchAgents/io.raskell.kurumi-agent.*.plist`,
   log in `~/Library/Logs/kurumi-agent.*.log`); on Linux a systemd user
   service (`journalctl --user -u kurumi-agent.*`). It runs as you, so it
   uses the same git credentials and SSH keys as your terminal. On Windows,
   run `watch` from Task Scheduler at log-on.

## What ends up in the repo

```
kurumi-sync.bin              # the whole database (all vaults), Automerge binary
.kurumi/vaults.json          # vault id → folder
work/                        # one folder per vault, named after it
  .kurumi/metadata.json      # folder tree, people, events, action items
  .kurumi/blobs/             # images and audio referenced by notes
  projects/roadmap.md        # one markdown file per note, mirroring folders
personal/
  …
```

Without **Write all vaults**, only the current vault is written, at the top
level of the folder.

## How merging works

`kurumi-sync.bin` is the source of truth. It's a CRDT, so the agent
registers a git **merge driver** for it that merges both sides the same way
the app does. Concurrent edits on two computers all survive.

The markdown files and `.kurumi/metadata.json` are regenerated from that
database by Kurumi on every sync. When git reports a conflict in one of
them, the agent keeps this machine's version, because the next Kurumi sync
rewrites it from the merged database anyway.

Editing a note's **text** in the `.md` files, for example on github.com,
works: Kurumi reads body and tag edits back on its next sync. Creating,
renaming or deleting notes should happen in Kurumi.

One edge case: two databases that never synced with each other, e.g. you
used Kurumi on two computers before setting up the repo. A plain CRDT merge
would silently keep only one of them, so the merge driver refuses. The
agent then keeps the local copy and saves the remote one as
`kurumi-sync.incoming-<n>.bin`. Kurumi merges that file with its recovery
logic on the next sync and deletes it.

## Downloading instead

For a one-off copy without git: Settings → Data → **Export as Markdown** →
**All vaults** downloads a ZIP with one folder per vault. Settings → Data →
**Export** gives a full JSON backup that can be restored.
