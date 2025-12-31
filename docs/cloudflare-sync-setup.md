# Cloudflare R2 Sync Setup Guide

This guide walks you through setting up cross-device sync for Kurumi using Cloudflare Workers and R2 storage.

## Prerequisites

- A Cloudflare account (free tier works)
- [mise](https://mise.jdx.dev/) installed (`brew install mise` or `curl https://mise.run | sh`)

## Quick Start

The worker project is included in this repo. Deploy with one command:

```bash
cd worker
mise run setup
```

This handles everything: dependencies, Cloudflare login, R2 bucket, token, and deployment.

Then configure Kurumi in Settings with your Worker URL and token.

---

## Overview

The sync architecture is simple:

```
┌─────────────┐     HTTPS      ┌─────────────────────┐     ┌─────────┐
│   Kurumi    │ ──────────────▶│  Cloudflare Worker  │────▶│   R2    │
│   (Client)  │  Bearer Token  │   (GET/PUT /sync)   │     │ Bucket  │
└─────────────┘                └─────────────────────┘     └─────────┘
```

- **GET /sync**: Download the latest Automerge document
- **PUT /sync**: Upload your merged document
- **Bearer Token**: Simple authentication for personal use

## Manual Setup (Step by Step)

If you prefer to run each step individually:

```bash
cd worker

# Install dependencies
mise run install

# Login to Cloudflare
mise run login

# Create R2 bucket
mise run bucket

# Generate a sync token (save this!)
mise run token

# Set the token as a secret (paste the token when prompted)
mise run secret

# Deploy
mise run deploy
```

---

## Reference: Worker Implementation

The worker code is in `worker/src/index.ts`. Here's how it works:

```typescript
interface Env {
  KURUMI_BUCKET: R2Bucket;
  SYNC_TOKEN: string;
}

const OBJECT_KEY = 'kurumi-doc.automerge';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Verify path
    const url = new URL(request.url);
    if (url.pathname !== '/sync') {
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    }

    // Authenticate
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
    }

    const token = authHeader.slice(7);
    if (token !== env.SYNC_TOKEN) {
      return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
    }

    // Handle GET - Download document
    if (request.method === 'GET') {
      const object = await env.KURUMI_BUCKET.get(OBJECT_KEY);
      if (!object) {
        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      }

      return new Response(object.body, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/octet-stream',
          'ETag': object.httpEtag,
        }
      });
    }

    // Handle PUT - Upload document
    if (request.method === 'PUT') {
      const body = await request.arrayBuffer();
      await env.KURUMI_BUCKET.put(OBJECT_KEY, body, {
        httpMetadata: {
          contentType: 'application/octet-stream'
        }
      });

      return new Response('OK', { status: 200, headers: CORS_HEADERS });
    }

    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }
};
```

## Configure Kurumi

1. Open Kurumi and go to **Settings**
2. In the **Cloudflare Sync** section:
   - **Sync Worker URL**: `https://kurumi-sync.your-subdomain.workers.dev/sync`
   - **Sync Token**: Your generated token from Step 3
3. Click **Save Settings**
4. Click **Test Connection** to verify it works
5. Click **Sync Now** to perform your first sync

## Usage

### Manual Sync
Click **Sync Now** in Settings whenever you want to sync.

### How Sync Works
1. **Pull**: Download the remote document from R2
2. **Merge**: Automerge CRDT automatically merges changes (no conflicts!)
3. **Push**: Upload the merged document back to R2

### Multiple Devices
1. Set up Kurumi on each device with the same Worker URL and token
2. Sync on Device A after making changes
3. Sync on Device B to receive those changes
4. Edits on both devices merge automatically - no conflicts

## Troubleshooting

### "Connection failed" error
- Verify your Worker URL ends with `/sync`
- Check that the Worker is deployed: `wrangler tail`
- Verify the token matches exactly

### "Invalid authentication token" error
- The token in Kurumi must match the `SYNC_TOKEN` secret in your Worker
- Re-set the secret: `wrangler secret put SYNC_TOKEN`

### Changes not syncing
- Make sure you click "Sync Now" on both devices
- Check the Worker logs: `wrangler tail`

### CORS errors in browser console
- Ensure the Worker returns proper CORS headers
- The provided Worker code handles this automatically

## Cost

Cloudflare's free tier includes:
- **Workers**: 100,000 requests/day
- **R2**: 10 GB storage, 10 million reads/month, 1 million writes/month

For personal use, you'll likely never exceed these limits.

## Security Notes

- Your token is sent via HTTPS (encrypted in transit)
- R2 data is encrypted at rest by Cloudflare
- Only someone with your token can access your data
- Consider rotating your token periodically

For more details on the security model, see [Local-First Architecture](./local-first-architecture.md).
