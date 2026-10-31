# Troubleshooting

## The app

| Problem | What to do |
|---------|------------|
| Stuck on an old version | Wait for the *Reload* prompt, or Settings → Offline & storage → **Reset offline copy** (notes stay) |
| "This vault was saved by a newer Kurumi" | Another device synced with a newer version. Reload to update this one |
| Slow start with many notes | Settings → Offline & storage → *Startup* shows the load time. [Optimize the vault](offline.md#optimize-a-big-vault) |
| Notes gone after clearing site data | Browser storage was wiped. Restore from sync (set it up again and sync) or from a JSON backup. Ask the browser to *Keep data* in Settings → Offline & storage |
| A file says it hasn't synced to this device yet | Sync the device that added it, then this one |
| Sharing into Kurumi / opening `.md` files does nothing | Only in the installed app on Chrome/Edge (sharing: Android). See [what each platform supports](offline.md#what-each-platform-supports) |

## Sync

| Problem | What to do |
|---------|------------|
| Sync button says *Offline* | It syncs as soon as the device is back online |
| "The synced copy is encrypted. Enter its passphrase" | Settings → Sync → End-to-end encryption → enter the passphrase |
| "The passphrase doesn't open the synced copy" | Check for typos; the passphrase may have been changed on another device |
| "Forbidden" (Kurumi server) | This device's token isn't valid on the server. Re-pair it with *Add a device* |
| Git: authentication failed | The token expired or lacks write access to the repo |
| Git: a conflict dialog | The same note changed on both sides; pick a side or combine them |
| Local folder: permission prompt every time | Browsers ask again after a restart; click *Allow*. Installed apps keep the permission longer |
| Two devices show different notes | Sync both, one after the other. Check that both use the same method and server (Settings → Sync) |

More on the server: [sync server troubleshooting](sync-server.md#troubleshooting).
More on the git agent: [agent/README.md](../agent/README.md).

## AI

| Problem | What to do |
|---------|------------|
| Transcription stuck on "downloading" | Settings → Local AI → clear the model cache and download again |
| Ask Kurumi asks for setup | Add an API key (Settings → AI assistant) or turn on a local text model (Settings → Local AI) |
| Transcribing offline fails | The Whisper model hasn't been downloaded on this device yet: Settings → Local AI → *Download all* while online |

## Still stuck

Open an issue on [GitHub](https://github.com/raskell-io/kurumi/issues)
or [Codeberg](https://codeberg.org/raskell-io/kurumi/issues) with the
version from Settings → Offline & storage and what you did.
