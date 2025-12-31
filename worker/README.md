# Kurumi Sync Worker

Cloudflare Worker for syncing Kurumi notes across devices.

## Quick Start

```bash
# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Create R2 bucket
npx wrangler r2 bucket create kurumi-sync

# Generate a sync token
openssl rand -base64 32

# Set the token as a secret
npx wrangler secret put SYNC_TOKEN
# Paste your token when prompted

# Deploy
npm run deploy
```

## Configuration

After deployment, configure Kurumi:

1. Go to **Settings** in Kurumi
2. Enter your Worker URL: `https://kurumi-sync.<your-subdomain>.workers.dev/sync`
3. Enter your sync token
4. Click **Test Connection**

## Development

```bash
# Run locally
npm run dev

# View logs
npm run tail
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /sync | Download Automerge document |
| PUT | /sync | Upload Automerge document |

All requests require `Authorization: Bearer <token>` header.
