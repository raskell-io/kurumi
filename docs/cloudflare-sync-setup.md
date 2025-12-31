# Cloudflare R2 Sync Setup Guide

This guide walks you through setting up cross-device sync for Kurumi using Cloudflare Workers and R2 storage.

## Prerequisites

- A Cloudflare account (free tier works)
- Node.js 18+ installed
- Wrangler CLI (`npm install -g wrangler`)

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

## Step 1: Create an R2 Bucket

1. Log into the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **R2 Object Storage** in the sidebar
3. Click **Create bucket**
4. Name it `kurumi-sync` (or any name you prefer)
5. Choose a location close to you
6. Click **Create bucket**

## Step 2: Create the Worker

Create a new directory for your worker:

```bash
mkdir kurumi-sync-worker
cd kurumi-sync-worker
npm init -y
```

Create `wrangler.toml`:

```toml
name = "kurumi-sync"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Bind your R2 bucket
[[r2_buckets]]
binding = "KURUMI_BUCKET"
bucket_name = "kurumi-sync"  # Use your bucket name from Step 1
```

Create `src/index.ts`:

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

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

Install dependencies:

```bash
npm install -D typescript @cloudflare/workers-types wrangler
```

## Step 3: Generate a Sync Token

Generate a secure random token for authentication:

```bash
# Using openssl
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Save this token - you'll need it for both the Worker and Kurumi.

## Step 4: Deploy the Worker

1. Login to Wrangler:

```bash
wrangler login
```

2. Set your sync token as a secret:

```bash
wrangler secret put SYNC_TOKEN
# Paste your generated token when prompted
```

3. Deploy the Worker:

```bash
wrangler deploy
```

4. Note your Worker URL (e.g., `https://kurumi-sync.your-subdomain.workers.dev`)

## Step 5: Configure Kurumi

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
