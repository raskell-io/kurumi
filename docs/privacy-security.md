# Privacy & security

Kurumi has no account and no Kurumi server. The app is a static site; it
has no analytics and no telemetry. What you write stays in your browser
unless you set up sync or AI providers yourself.

## Where your data is

| Place | What | Who can read it |
|-------|------|-----------------|
| Your browser (IndexedDB, localStorage) | Notes, files, settings, API keys, encryption keys | You, anyone using your unlocked device and browser profile, browser extensions allowed to read the site |
| Your sync storage | The database and files | Whoever controls that storage, unless [encrypted](encryption.md) |
| Git host | Notes as Markdown, files | You and whoever can read the repo (keep it private) |
| AI providers | The text of tasks you send them | That provider, under your account and its terms |

## Sync

- All sync traffic uses HTTPS.
- The Kurumi server authenticates with a random token and stores only its
  hash. The *Add a device* link contains the token: treat it like a
  password.
- With [end-to-end encryption](encryption.md) (Kurumi server, S3, WebDAV,
  Azure), the storage provider only sees ciphertext and file sizes.
- Git sync from the browser stores a personal access token in the browser
  and goes through a public CORS proxy. The
  [sync agent](../agent/README.md) avoids both.

## AI

- On-device models: nothing leaves the device.
- With an API key: the text needed for that task (a transcript, a note,
  your question with the notes found for it) goes to the provider. Keys
  are stored in this browser and sent only to their provider.
- See [What runs where](ai.md#what-runs-where).

## On the device

Anyone who can use your browser profile can open Kurumi. Use your
device's lock screen and a separate browser profile if others use the
computer. Turning on encryption protects the sync copy, not the copy in
the browser.

## Recommendations

1. Keep a second copy: [sync](sync.md) to another device, or export a
   JSON backup now and then.
2. Use a private repo for git sync, and a token limited to that repo.
3. Turn on encryption if you sync to storage you don't fully control,
   and keep the passphrase somewhere safe.
4. Protect your Cloudflare account (or other storage) with two-factor
   sign-in.

## Reporting a security problem

Please open an issue without exploit details, or contact the maintainer
through [raskell.io](https://raskell.io/about/), and allow time for a fix
before publishing.
