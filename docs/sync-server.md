# Your own sync server

The Kurumi sync server is a small Cloudflare Worker that stores your sync
copy and files in an R2 bucket, both on **your** Cloudflare account. The
free plan covers personal use, and you don't need a command line.

```
Phone ─┐                      your Cloudflare account
Laptop ┼── HTTPS + token ──▶  Worker (kurumi-sync)  ──▶  R2 bucket
Tablet ┘                       GET/PUT /sync              kurumi-doc.automerge
                                                          kurumi-blobs/…
```

## Set it up

1. **Deploy.** Click the button (also in Kurumi: Settings → Sync →
   Kurumi server → *Deploy to Cloudflare*):

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/raskell-io/kurumi/tree/main/worker)

   Sign in or create a free Cloudflare account, keep the suggested
   names, and let Cloudflare create the Worker and the bucket.

2. **Connect.** Open the Worker's address shown at the end (like
   `https://kurumi-sync.<you>.workers.dev`) and click **Connect Kurumi**.
   Kurumi opens and this device starts syncing.

   Do this right after deploying: the first person to connect owns the
   server, and the button disappears after that.

3. **Add your other devices.** On a device that already syncs: Settings →
   Sync → **Add a device** → *Show link*. Open that link on the new
   device (send it to yourself, scan it, AirDrop it). The new device sets
   itself up and syncs.

The *Add a device* link works like a key to the server. Send it only to
yourself. If you've turned on [encryption](encryption.md), the new device
also needs the passphrase, which is never part of the link.

## Already set up the old way?

Servers deployed with a `SYNC_TOKEN` secret keep working. In Kurumi:
Settings → Sync → Kurumi server → *Enter a server address and token by
hand*: the address ending in `/sync` and the token. *Add a device* works
from there too. The command-line setup is described in
[worker/README.md](../worker/README.md).

## Cost

Cloudflare's free plan includes 100,000 Worker requests a day and 10 GB
of R2 storage with 1 million writes and 10 million reads a month. A sync
is a handful of requests, so personal use stays far below that.

## What the server can see

Without encryption, whoever controls the Cloudflare account (you, and
Cloudflare itself) could read the stored copy. With
[end-to-end encryption](encryption.md) the bucket only holds ciphertext.
The token is stored as a SHA-256 hash, in a place the sync API can't
reach.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| *Connect Kurumi* says the server is already connected | Someone (probably you) connected already. Use *Add a device* on a device that syncs. If none does, redeploy a new server |
| "Forbidden" / "Unauthorized" | The token on this device doesn't match. Re-add the device with a fresh link |
| Sync errors right after deploy | Wait a minute for the Worker and bucket to be ready, then press sync |
| Changes don't show on the other device | Check that both say *Synced*; sync runs when the app is open, see [When sync runs](sync.md#when-sync-runs) |
| "The synced copy is encrypted" | Enter the passphrase in Settings → Sync, see [Encryption](encryption.md) |

Live logs: `cd worker && npx wrangler tail` (or `mise run tail`).
