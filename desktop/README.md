# Kurumi desktop

A [Tauri](https://tauri.app) app around the static web build: a `.dmg`
for Mac (one universal file for Apple Silicon and Intel), an installer
`.exe` for Windows and an `.AppImage` for Linux, around 20–25 MB each
(Electron needed about 150 MB per platform; most of what remains is the
web build itself).

Tauri uses the system's web engine (WebKit on macOS and Linux, WebView2 on
Windows) instead of shipping one. The build is served from a fixed origin
(`tauri://localhost`; `https://tauri.localhost` on Windows), so the vault
in IndexedDB survives restarts and updates.

## Run and package

Needs Rust (`rustup`) and, on Linux, Tauri's
[system packages](https://tauri.app/start/prerequisites/).

```bash
npm run build            # at the repo root: the web build in build/
cd desktop
npm install
npm run dev              # the app on the dev server (localhost:5173)
npm test                 # debug build + self-test (below)
npm run dist             # installers for this OS in src-tauri/target/release/bundle/
npm run dist -- --target universal-apple-darwin   # one Mac app for both chips
```

The app embeds `build/` when it's compiled: rebuild after changing the web
app. The version is the root `package.json` version (`tauri.conf.json`).
Pushing a `vX.Y.Z` tag builds all three platforms, self-tests them and
attaches them to the GitHub release (`.github/workflows/desktop.yml`).

## How it fills the gaps

| Web feature | In the desktop app |
|---|---|
| Local folder sync (`showDirectoryPicker`, which WebKit lacks) | `src/lib/desktop/folder-handle.ts` stands in for the File System Access API, backed by `src-tauri/src/folders.rs`. Its commands only reach folders picked in the system dialog (remembered in `folders.json` in the app's config folder), also after resolving symlinks |
| Service worker | None: WebKit has none on `tauri:`. The files are on disk, so it starts offline and updates with the app (`isDesktopApp()` in `src/lib/pwa.ts`) |
| Due to-do notifications | `tauri-plugin-notification` provides `window.Notification`; no Mark done / Snooze buttons |
| Downloads (exports, backups) | Saved to the Downloads folder (`on_download` in `lib.rs`) |
| Links to the web | Open in the default browser |
| Dropping files into a note | The window leaves drops to the page (`disable_drag_drop_handler`) |

Not wired yet: opening `.md` files with Kurumi, the icon shortcuts and an
auto-updater (a new version means downloading the new installer). On macOS
and Linux the engine is WebKit, so what works in Safari works here; tab
audio for meetings depends on the system's screen-capture support.

## Self-test

`node selftest.mjs` (after `npm run build:debug`, or with
`KURUMI_EXE=<executable>` for a release build) starts the app twice with
`KURUMI_SELFTEST=<temp dir>`. In that mode the app keeps its data in the
temp dir (a separate WebKit store on macOS), answers the folder dialog with
`<dir>/folder` and injects `src-tauri/src/selftest.js`, which checks the
origin, folder sync through the real commands (and that paths outside are
refused), downloads, notifications, a deep link, and that data and the
picked folder survive the restart. Without the variable none of it is
active. `cargo test` in `src-tauri` covers `folders.rs`.

## Signing

Builds aren't signed with a developer certificate yet:

- **macOS:** ad-hoc signed (`signingIdentity: "-"`). The first launch is
  refused; open System Settings → Privacy & Security → *Open Anyway* (or
  run `xattr -dr com.apple.quarantine /Applications/Kurumi.app`). A
  Developer ID and notarization remove that step.
- **Windows:** SmartScreen warns (*More info* → *Run anyway*) until the
  installer is signed.
