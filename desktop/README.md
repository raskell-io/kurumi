# Kurumi desktop

An Electron shell around the static web build, packaged as a `.dmg`
(macOS), an installer `.exe` (Windows) and an `.AppImage` (Linux).

It serves `../build` from `app://kurumi`. That origin never changes, so
the vault (IndexedDB) survives restarts and updates. The scheme counts as
secure, so local folder sync, the microphone and notifications work as
they do in Chrome. Links to the web open in the default browser.

## Run and package

```bash
npm run build            # at the repo root: the web build in build/
cd desktop
npm install
npm start                # the app, on ../build
npm test                 # smoke test (uses puppeteer from the root install)
npm run dist             # installers for this OS in dist/
```

`KURUMI_DEV_URL=http://localhost:5173 npm start` loads the dev server
instead (a different origin, so a separate vault). `KURUMI_EXE=<packaged
executable> npm test` tests a packaged app, e.g.
`dist/mac-arm64/Kurumi.app/Contents/MacOS/Kurumi`.

The app version is the root `package.json` version
(`electron-builder.config.cjs`). Pushing a `vX.Y.Z` tag builds all three
platforms and attaches them to the GitHub release
(`.github/workflows/desktop.yml`).

## Differences from the web app

- **No service worker.** Chromium's Cache API refuses `app:` URLs. The
  app's files are on disk, so it starts offline anyway; `isDesktopApp()`
  in `src/lib/pwa.ts` skips the registration. Due to-do notifications
  are plain ones (clicking opens To-dos) without Mark done / Snooze
  buttons. The ONNX runtime for local AI only sits in the ordinary HTTP
  cache, not the worker's, so local AI may need a connection to start.
- **No updater yet.** A new version means downloading the new installer.
- **Its own data.** The desktop app's vault is separate from the
  browser's. Move notes over with sync or a backup.
- **Shortcuts:** the menu leaves `Cmd/Ctrl+R`, `Shift+R` and `Shift+I`
  to Kurumi. Reload is F5, DevTools `Alt+Cmd+J` / F12.
- Not wired yet: opening `.md` files with Kurumi and the icon shortcuts
  (the web app gets those from the manifest).

## Signing

Builds aren't signed with a developer certificate yet:

- **macOS:** ad-hoc signed. The first launch is refused; open System
  Settings → Privacy & Security → *Open Anyway* (or run
  `xattr -dr com.apple.quarantine /Applications/Kurumi.app`). A Developer
  ID and notarization (`mac.identity`, `notarize`) remove that step.
- **Windows:** SmartScreen warns ("More info" → *Run anyway*) until the
  installer is signed (`win.signtoolOptions` or Azure Trusted Signing).
