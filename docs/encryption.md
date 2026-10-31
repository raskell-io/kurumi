# End-to-end encryption

With a sync passphrase, Kurumi encrypts the database and every file
**before** they leave the device. The storage (your Kurumi server, S3,
WebDAV or Azure) only ever holds ciphertext; only devices that know the
passphrase can read it.

Git and the local folder are never encrypted: they exist to give you
plain Markdown files.

## Turn it on

Settings → Sync → **End-to-end encryption** → choose a passphrase (at
least 8 characters, longer is better) → *Turn on*.

The next sync uploads an encrypted copy. Every other device notices on
its next sync and asks for the passphrase once; after that it remembers
a key derived from it.

**Write the passphrase down.** There's no recovery: without it, the
synced copy can't be read. Your devices keep their own copies, so the
notes themselves aren't lost, but a new device can't join.

## Add a device

Pair it as usual ([Add a device](sync-server.md#set-it-up) for the Kurumi
server, or enter the same storage details), then enter the passphrase
when Kurumi asks. A mistyped passphrase is simply rejected; it can't
lock the device out.

## Change the passphrase

*Turn off*, then straight away turn it on again with the new passphrase
(a sync in between would upload a readable copy). The next upload uses a
new key; other devices ask for the new passphrase on their next sync.

## Turn it off

*Turn off* on any device switches off encryption for all of them: the
next sync uploads a readable copy. Devices keep their keys, so they can
still read the last encrypted copy once.

## How it works

| | |
|---|---|
| Cipher | AES-256-GCM, a fresh random IV for every upload |
| Key | PBKDF2-SHA-256 with 600,000 iterations over the passphrase and a random 16-byte salt |
| File format | `KRMENC01` · salt · IV · ciphertext and tag |
| On or off | A setting in the synced database, so all devices follow it |
| Keys | Per device in IndexedDB, as non-extractable keys; the passphrase itself isn't stored |

Devices adopt the salt of the copy they open, so one passphrase opens
everything. Encryption covers the sync copy and files; the copy on each
device is protected by the device and browser (see
[Privacy & security](privacy-security.md)).
