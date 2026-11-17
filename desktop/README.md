# Kurumi desktop

A [Tauri](https://tauri.app) app around the static web build: a `.dmg`
for Mac (one universal file for Apple Silicon and Intel), an installer
`.exe` for Windows and an `.AppImage` for Linux: about 24 MB, 10 MB and
90 MB (the AppImage carries its own WebKit). Electron needed about 150 MB
per platform.

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
| Linked folder vaults (a folder of Markdown notes used in place) | `src-tauri/src/linked.rs`: `linked_open` scans a picked folder (`.md` / `.markdown`, skipping hidden entries, the vault's ignore patterns and, if asked, `.gitignore`) and watches it; `linked_changes` is a long poll for what changed (file events, or a comparison every 5 s where the watcher can't start): notes with their text and, with `files: true`, the other files the page has read (size and time only); `linked_write` replaces a note only if its hash is still the one the app saw, `linked_create` never replaces one; `linked_read_bytes` hands the page an image or attachment (up to 25 MB) and `linked_reveal` shows a note in the file manager. Only inside picked folders, like `folders.rs` |
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
picked folder survive the restart. It also links `<dir>/linked` (notes with
another tool's frontmatter, written by `selftest.mjs`) as a vault through the
app's own menus and uses it for real: the notes are listed and a link by `id`
opens its note, a file changed from outside shows up through the watcher, an
image a note shows is reported when it is replaced on disk, an
edit changes its line in the file and nothing else, a file changed on disk
since it was read is not overwritten, a blank new note becomes a file with its
first words, and after the
restart the vault is current again without a folder dialog. At the end the
folder must hold those edits and nothing of Kurumi. Without the variable none
of it is active. `cargo test` in `src-tauri` covers `folders.rs` and
`linked.rs`.

## Signing

**macOS** is signed with a Developer ID and notarized in CI once the secrets
below are set on the GitHub repository (Settings → Secrets and variables →
Actions). Without them the app is ad-hoc signed (`signingIdentity: "-"`):
the first launch is refused, and users open System Settings → Privacy &
Security → *Open Anyway* (or run `xattr -dr com.apple.quarantine
/Applications/Kurumi.app`). The release notes say which applies.

Setup (needs the paid Apple Developer Program):

1. **Certificate.** In Xcode → Settings → Accounts → *Manage Certificates*,
   add a **Developer ID Application** certificate (an *Apple Development* one
   can't distribute). In Keychain Access, export it with its private key as a
   `.p12` with a password.
2. **Notarization key.** App Store Connect → Users and Access → Integrations
   → App Store Connect API → *Team Keys*: generate a key with the *Developer*
   role and download the `.p8` (once only).
3. **Secrets:**

   | Secret | Value |
   |--------|-------|
   | `APPLE_CERTIFICATE` | `base64 -i cert.p12 \| pbcopy` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
   | `APPLE_SIGNING_IDENTITY` | the certificate's name, e.g. `Developer ID Application: Your Name (TEAMID)` (`security find-identity -v -p codesigning`) |
   | `APPLE_API_KEY` | the key ID |
   | `APPLE_API_ISSUER` | the issuer ID (above the keys list) |
   | `APPLE_API_KEY_P8` | the contents of `AuthKey_<ID>.p8` |

   With `gh`: `gh secret set APPLE_CERTIFICATE < <(base64 -i cert.p12)`,
   `gh secret set APPLE_API_KEY_P8 < AuthKey_XXXX.p8`, and so on.

The workflow (`desktop.yml`, *macOS signing setup*) hands them to Tauri,
which imports the certificate into a temporary keychain, signs with the
hardened runtime, notarizes and staples. *Check signature and notarization*
then runs `codesign --verify`, `spctl --assess` and `stapler validate`. A
certificate without the notarization secrets fails the build: signed but not
notarized is still blocked by Gatekeeper.

**Windows:** not signed yet; SmartScreen warns (*More info* → *Run
anyway*) until the installer is signed.

**Linux:** AppImages aren't signed.
