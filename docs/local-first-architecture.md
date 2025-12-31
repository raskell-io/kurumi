# Local-First Architecture

Kurumi is built on **local-first** principles. This document explains what that means, how sync works across devices, and how your data stays secure.

## What is Local-First?

Local-first software keeps your data on your device first, with optional sync to other devices. This is the opposite of cloud-first apps where data lives on a server.

| Aspect | Cloud-First | Local-First (Kurumi) |
|--------|-------------|----------------------|
| Data location | Server | Your device |
| Works offline | Limited/No | Full functionality |
| Speed | Network latency | Instant |
| Ownership | Provider controls | You control |
| Privacy | Data on their servers | Data stays local |

## How Kurumi Stores Data

### IndexedDB (Local Storage)

All your notes, folders, and vaults are stored in your browser's IndexedDB:

```
Browser
└── IndexedDB
    └── kurumi-doc (Automerge binary)
        ├── notes: { id → Note }
        ├── folders: { id → Folder }
        ├── vaults: { id → Vault }
        ├── people: { id → Person }
        └── events: { id → Event }
```

This data:
- Persists across browser restarts
- Works completely offline
- Is only accessible to Kurumi on your device
- Can be exported to JSON anytime

### Automerge (CRDT)

Kurumi uses [Automerge](https://automerge.org/), a Conflict-free Replicated Data Type (CRDT) library. This is the magic that makes sync work without conflicts.

**Traditional sync problem:**
```
Device A: Change title to "Meeting Notes"
Device B: Change title to "Project Notes"
         ↓
      CONFLICT! Which one wins?
```

**Automerge solution:**
```
Device A: Change title to "Meeting Notes" (timestamp: T1)
Device B: Change title to "Project Notes" (timestamp: T2)
         ↓
      Both changes preserved in history
      Deterministic resolution (e.g., T2 > T1, so "Project Notes" wins)
      No manual conflict resolution needed
```

For most edits (adding notes, editing content, organizing folders), changes merge seamlessly without any conflicts.

## Cross-Device Sync

### The Sync Flow

```
┌─────────────┐                    ┌─────────────┐
│  Device A   │                    │  Device B   │
│  (Phone)    │                    │  (Laptop)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. PUSH local doc                │
       │ ──────────────────────▶          │
       │                     ┌────────────┴────────────┐
       │                     │   Cloudflare R2         │
       │                     │   (kurumi-doc.automerge)│
       │                     └────────────┬────────────┘
       │                                  │
       │          2. PULL remote doc      │
       │ ◀──────────────────────          │
       │                                  │
       │ 3. MERGE (Automerge)             │
       │ ─────────────────────            │
       │                                  │
       │ 4. PUSH merged doc               │
       │ ──────────────────────▶          │
       │                                  │
       │                                  │ 5. PULL merged doc
       │                                  │ ◀──────────────────
       │                                  │
       │                                  │ 6. MERGE (Automerge)
       │                                  │ ─────────────────────
```

### What Gets Synced

The sync transfers a single binary blob containing your entire Automerge document. This includes:

- All notes (content, titles, metadata)
- All folders and their hierarchy
- All vaults
- All people and events
- Complete edit history (for merge resolution)

### Sync is Manual (For Now)

Currently, you click "Sync Now" to trigger sync. This is intentional:
- You control when data leaves your device
- No background network activity
- Works reliably on spotty connections

Future versions may add automatic sync with proper offline queue handling.

## Security Model

### Threat Model

Kurumi's security is designed for **personal use** with these assumptions:
- You trust your own devices
- You control your Cloudflare account
- You keep your sync token private

### Data in Transit

```
Kurumi ──── HTTPS/TLS ────▶ Cloudflare Worker ────▶ R2
       (encrypted)                            (encrypted)
```

- All sync traffic uses HTTPS (TLS 1.3)
- Data is encrypted between your device and Cloudflare
- Bearer token authentication prevents unauthorized access

### Data at Rest

| Location | Encryption | Who Can Access |
|----------|------------|----------------|
| Your browser (IndexedDB) | Browser-managed | You (and browser extensions with permissions) |
| Cloudflare R2 | Encrypted at rest | You (with sync token) |

### Authentication

Sync uses Bearer token authentication:

```
Authorization: Bearer <your-sync-token>
```

- Only requests with the correct token can read/write your data
- The token is stored in your browser's localStorage
- Generate a strong token (32+ random bytes)

### What Kurumi Does NOT Do

- **No end-to-end encryption**: Data is encrypted in transit and at rest, but Cloudflare (and anyone with your R2 access) could theoretically read it
- **No zero-knowledge**: The sync server sees your data
- **No password protection**: Anyone with physical access to your device can open Kurumi

### Recommendations

1. **Use a strong sync token**: Generate with `openssl rand -base64 32`
2. **Rotate tokens periodically**: Update in both Worker and Kurumi
3. **Secure your devices**: Use device passwords/biometrics
4. **Trust your Cloudflare account**: Use 2FA, secure password
5. **Export backups**: Regularly export to JSON for offline backup

## Privacy

### What Data Leaves Your Device

Only when you click "Sync Now":
- Your entire Automerge document (notes, folders, etc.)
- Sent to YOUR Cloudflare Worker (not Anthropic, not us)

### What We (Kurumi developers) Can See

**Nothing.** We have no servers, no analytics, no telemetry. Kurumi is a static web app that runs entirely in your browser.

### What Cloudflare Can See

If you use Cloudflare sync:
- Your R2 bucket contents (encrypted at rest)
- Worker request logs (can be disabled)
- They cannot read your sync token (stored as a secret)

## Comparison with Other Apps

| Feature | Kurumi | Notion | Obsidian | Apple Notes |
|---------|--------|--------|----------|-------------|
| Data location | Your device | Their servers | Your device | iCloud |
| Works offline | Yes | Limited | Yes | Yes |
| Sync provider | Your choice | Notion | Your choice | Apple only |
| Self-hostable | Yes | No | Partial | No |
| Open source | Yes | No | No | No |
| End-to-end encrypted | No | No | With plugin | Yes |

## Future Improvements

Potential enhancements under consideration:
- **End-to-end encryption**: Encrypt data before sync with a passphrase
- **Alternative sync backends**: Git, WebDAV, S3-compatible storage
- **Automatic sync**: Background sync with conflict-free CRDT handling
- **Selective sync**: Choose which vaults to sync

## Summary

Kurumi's local-first architecture means:

1. **Your data is yours**: Stored on your device, exportable anytime
2. **Works offline**: Full functionality without internet
3. **Sync is optional**: Only happens when you choose
4. **You control the infrastructure**: Your Cloudflare account, your token
5. **No vendor lock-in**: Export to JSON, use standard formats
6. **Conflict-free**: Automerge CRDT handles multi-device edits gracefully

This design prioritizes **user ownership** and **privacy** while still enabling the convenience of cross-device access.
