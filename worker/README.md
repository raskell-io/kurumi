# Kurumi Sync Worker

Cloudflare Worker for syncing Kurumi notes across devices.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed (`brew install mise` or `curl https://mise.run | sh`)

## Quick Start (One Command)

```bash
mise run setup
```

This will:
1. Install dependencies
2. Login to Cloudflare
3. Create the R2 bucket
4. Generate and set a sync token
5. Deploy the worker

## Manual Setup

```bash
# Install dependencies
mise run install

# Login to Cloudflare
mise run login

# Create R2 bucket
mise run bucket

# Generate a token (save this!)
mise run token

# Set the token as a secret
mise run secret

# Deploy
mise run deploy
```

## Available Tasks

| Command | Description |
|---------|-------------|
| `mise run setup` | Full setup (recommended for first time) |
| `mise run install` | Install npm dependencies |
| `mise run login` | Login to Cloudflare |
| `mise run bucket` | Create R2 bucket |
| `mise run token` | Generate a sync token |
| `mise run secret` | Set SYNC_TOKEN secret |
| `mise run deploy` | Deploy to Cloudflare |
| `mise run dev` | Run locally for development |
| `mise run tail` | View live worker logs |

## Configuration

After deployment, configure Kurumi:

1. Go to **Settings** in Kurumi
2. Enter your Worker URL: `https://kurumi-sync.<your-subdomain>.workers.dev/sync`
3. Enter your sync token
4. Click **Test Connection**

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /sync | Download Automerge document |
| PUT | /sync | Upload Automerge document |

All requests require `Authorization: Bearer <token>` header.
