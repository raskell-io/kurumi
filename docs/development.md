# Development

## Run it

```bash
git clone https://github.com/raskell-io/kurumi.git
cd kurumi
npm install
npm run dev        # http://localhost:5173
```

`npm run build` makes a static site in `build/`; `npm run preview`
serves it. The service worker (offline app, share target) only exists
in built versions, not in `npm run dev`.

## Checks

| Command | What it does |
|---------|--------------|
| `npm run check` | svelte-check: types, accessibility, CSS. Must report **0 errors and 0 warnings** |
| `npm test` | Unit tests (Vitest), including the sync worker's |
| `npm run test:e2e` | Browser scenarios (`e2e/smoke.mjs`): starts `vite dev`, drives a fresh Chrome profile through capture, editing, sync, the sync server with pairing and encryption, imports, … |
| `npm run test:pwa` | Builds, then checks the installed-app features (`e2e/pwa.mjs`): offline start, updates, share target, notification actions |
| `npm run screenshots` | Builds, then retakes the docs screenshots from the example vault (`e2e/screenshots.mjs`; `THEME=dark` for the dark set) |

The browser suites use puppeteer's Chrome, or the system Chrome on
macOS; set `CHROME_PATH` to choose one.

## CI and deploys

`.github/workflows/ci.yml` runs on every push:

- **check:** svelte-check, unit tests, production build;
- **browser:** both browser suites in a real window under `xvfb-run`
  (`HEADFUL=1`). Headless Chrome on Linux reports no mouse, which hides
  the hover UI the tests use.

`.github/workflows/deploy.yml` builds and publishes `main` to GitHub
Pages (kurumi.raskell.io). Deploys don't wait for CI.

## Releases

Versions follow semver.

```bash
npm version 0.5.0 --no-git-tag-version
git commit -am "chore: version 0.5.0"
git tag -a v0.5.0 -m "v0.5.0: what changed"
git push origin main v0.5.0      # origin pushes to GitHub and Codeberg
```

The app shows `version · commit · build date` in About and Settings →
Offline & storage. A release that changes how the document is stored
must set `minAppVersion` on documents in the new format (as
`PLAIN_FORMAT_SINCE` does in `src/lib/db/store.ts`), so older apps
refuse them instead of misreading them, and must bump the version before
it ships: the guard compares against `package.json`.

## Project layout

```
src/
├── lib/
│   ├── components/   Svelte components (Editor, FolderTree, CommandPalette, …)
│   ├── db/           The Automerge document: types, store, migrations, blobs
│   ├── editor/       Milkdown plugins: links, embeds, block handle, paste, find
│   ├── inference/    Provider interface, router, local and remote providers
│   ├── search/       MiniSearch index and query filters
│   ├── sync/         Sync methods, blob sync, encryption, pairing
│   ├── git/          isomorphic-git sync and Markdown conversion
│   ├── stores/       UI state: workspace, undo, notices, labs, lock
│   └── utils/        Imports, exports, publishing, web clipper
├── routes/           One folder per page (+ settings/[[section]])
static/               Icons, manifest assets, sw-notify.js, llms.txt
worker/               The sync server (Cloudflare Worker)
agent/                The local git sync agent (Node)
e2e/                  Browser tests and the screenshot script
docs/                 This documentation
```

Rules worth knowing before changing `src/lib/db/store.ts` (writing note
text, bulk changes, optimized vaults) are in
[.claude/CLAUDE.md](../.claude/CLAUDE.md#data-model), together with the
rest of the architecture notes.

## Contributing

Issues and pull requests are welcome on
[GitHub](https://github.com/raskell-io/kurumi) and
[Codeberg](https://codeberg.org/raskell-io/kurumi). Keep `npm run check`
at 0/0 and the test suites green, and add a browser scenario for UI flows
that type checks can't catch. MIT licensed.
