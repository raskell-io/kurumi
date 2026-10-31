# Kurumi sync server

Your own sync server for [Kurumi](https://kurumi.raskell.io): a small
Cloudflare Worker that stores the sync copy and attachments in an R2
bucket on **your** Cloudflare account. The free plan is plenty for
personal use.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/raskell-io/kurumi/tree/main/worker)

## Set up (no command line)

1. Click **Deploy to Cloudflare** above (or in Kurumi: Settings → Sync →
   Kurumi server → Deploy to Cloudflare). Sign in or create a free
   Cloudflare account and keep the suggested names. Cloudflare creates
   the Worker and the R2 bucket.
2. Open the Worker's address (shown when the deploy finishes, like
   `https://kurumi-sync.<you>.workers.dev`) and click **Connect Kurumi**.
   Kurumi opens and starts syncing on that device.
3. On every other device: in Kurumi on a device that already syncs, go
   to Settings → Sync → **Add a device**, and open that link on the new
   device.

Connecting works once: whoever connects first owns the server, so do
step 2 right after deploying. The link from *Add a device* works like a
key; send it only to yourself.

**Encryption:** turn on *End-to-end encryption* in Kurumi's Sync
settings and the server only ever stores ciphertext. Each device asks
for the passphrase once.

## How it works

| Route | |
|---|---|
| `GET /` | Setup page: *Connect Kurumi* until the server is claimed |
| `POST /claim` | First visit only: creates a token (stored as a SHA-256 hash in R2 under `kurumi-config/`) and returns a pairing link |
| `GET` / `PUT /sync` | The sync copy; `?key=` for attachments (confined to `kurumi-blobs/`) |

Requests need `Authorization: Bearer <token>`. `KURUMI_APP_URL` (in
`wrangler.toml`) is where pairing links open Kurumi.

## Manual setup (command line)

The older setup still works: a `SYNC_TOKEN` secret is accepted alongside
claimed tokens, and setting it marks the server as claimed.

```bash
mise run setup   # install, log in, create the bucket, set SYNC_TOKEN, deploy
```

Then in Kurumi: Settings → Sync → Kurumi server → *Enter a server
address and token by hand*: `https://kurumi-sync.<you>.workers.dev/sync`
and the token.

| Command | Description |
|---------|-------------|
| `mise run setup` | Full setup |
| `mise run deploy` | Deploy to Cloudflare |
| `mise run dev` | Run locally |
| `mise run tail` | Live logs |

Tests live in `src/index.test.ts` and run with Kurumi's `npm test`.
