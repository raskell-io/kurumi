/**
 * Kurumi sync server: a Cloudflare Worker storing the sync copy and blobs
 * in R2. Kurumi only ever stores opaque bytes here (sealed, when the user
 * turns on encryption).
 *
 *   GET  /        setup page: claim the server and connect Kurumi
 *   POST /claim   first visit only: create the token, return a pairing link
 *   GET  /sync    download the document (or `?key=` a blob object)
 *   PUT  /sync    upload it
 *
 * Tokens: the SYNC_TOKEN secret (manual setup, still supported) or the one
 * created by claiming, stored as a SHA-256 hash in R2 under kurumi-config/
 * (out of reach of `?key=`, which is confined to kurumi-blobs/). Claiming
 * works once; a claimed server shows no secrets on its page. Further
 * devices are paired from Kurumi (Settings → Sync → Add a device).
 */

export interface Env {
	KURUMI_BUCKET: R2Bucket;
	SYNC_TOKEN?: string;
	/** Where Kurumi runs; pairing links open it. */
	KURUMI_APP_URL?: string;
}

const OBJECT_KEY = 'kurumi-doc.automerge';
const TOKENS_KEY = 'kurumi-config/tokens.json';
const DEFAULT_APP_URL = 'https://kurumi.raskell.io';

/**
 * Resolve the R2 object key for a request. The Automerge document lives at
 * the fixed OBJECT_KEY (backward compatible). Blob sync passes a `?key=`
 * query param (manifest + per-blob objects), which we namespace under
 * `kurumi-blobs/` and sanitize so it can't escape the prefix.
 */
function resolveKey(url: URL): string {
	const key = url.searchParams.get('key');
	if (!key) return OBJECT_KEY;
	const safe = key.replace(/[^A-Za-z0-9._\-/]/g, '_').replace(/\.{2,}/g, '_');
	return `kurumi-blobs/${safe}`;
}

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type'
};

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tokenHashes(env: Env): Promise<string[]> {
	const object = await env.KURUMI_BUCKET.get(TOKENS_KEY);
	if (!object) return [];
	try {
		const parsed = JSON.parse(await object.text());
		return Array.isArray(parsed.hashes) ? parsed.hashes : [];
	} catch {
		return [];
	}
}

async function isClaimed(env: Env): Promise<boolean> {
	return !!env.SYNC_TOKEN || (await tokenHashes(env)).length > 0;
}

/** Constant-time comparison for equal-length strings. */
function sameText(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function authorized(env: Env, token: string): Promise<boolean> {
	if (env.SYNC_TOKEN && sameText(token, env.SYNC_TOKEN)) return true;
	const hash = await sha256(token);
	return (await tokenHashes(env)).some((h) => sameText(h, hash));
}

const base64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pairingLink(appUrl: string, syncUrl: string, token: string): string {
	const code = base64Url(new TextEncoder().encode(JSON.stringify({ url: syncUrl, token })));
	return `${appUrl.replace(/\/$/, '')}/#/settings/sync?pair=${code}`;
}

async function claim(request: Request, env: Env): Promise<Response> {
	if (await isClaimed(env)) {
		return Response.json({ error: 'This sync server is already connected. Add devices from Kurumi: Settings → Sync → Add a device.' }, { status: 409 });
	}
	const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	await env.KURUMI_BUCKET.put(TOKENS_KEY, JSON.stringify({ hashes: [await sha256(token)], claimedAt: new Date().toISOString() }), {
		httpMetadata: { contentType: 'application/json' }
	});
	const origin = new URL(request.url).origin;
	return Response.json({ link: pairingLink(env.KURUMI_APP_URL || DEFAULT_APP_URL, `${origin}/sync`, token) });
}

function setupPage(claimed: boolean): Response {
	const body = claimed
		? `<p>This sync server is connected to Kurumi.</p>
		   <p class="muted">To add another device, open Kurumi on a device that already syncs and go to <b>Settings → Sync → Add a device</b>.</p>`
		: `<p>Your own sync server is running. Connect it to Kurumi:</p>
		   <button id="connect">Connect Kurumi</button>
		   <p class="muted">Opens Kurumi and sets up sync on this device. This works once: whoever connects first owns the server, so do it now.</p>
		   <p id="error" class="error"></p>
		   <script>
		   document.getElementById('connect').onclick = async (e) => {
		     e.target.disabled = true;
		     const res = await fetch('/claim', { method: 'POST' });
		     const data = await res.json();
		     if (res.ok) location.href = data.link;
		     else { document.getElementById('error').textContent = data.error; e.target.disabled = false; }
		   };
		   </script>`;
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
		<title>Kurumi sync server</title>
		<style>
		  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 12vh auto; padding: 0 1rem; color: #1e1e2e; background: #fff; }
		  @media (prefers-color-scheme: dark) { body { color: #cdd6f4; background: #1e1e2e; } }
		  h1 { font-size: 1.4rem; } .muted { opacity: .7; font-size: .9rem; } .error { color: #d20f39; }
		  button { font: inherit; padding: .6rem 1.1rem; border: 0; border-radius: .5rem; background: #7287fd; color: #fff; cursor: pointer; }
		  button:disabled { opacity: .6; }
		</style></head><body><h1>🌰 Kurumi sync server</h1>${body}</body></html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		const url = new URL(request.url);
		if (url.pathname === '/' && request.method === 'GET') return setupPage(await isClaimed(env));
		if (url.pathname === '/claim' && request.method === 'POST') return claim(request, env);
		if (url.pathname !== '/sync') {
			return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
		}

		// Authenticate
		const authHeader = request.headers.get('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
		}
		if (!(await authorized(env, authHeader.slice(7)))) {
			return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
		}

		const objectKey = resolveKey(url);

		// Handle GET - Download document or blob object
		if (request.method === 'GET') {
			const object = await env.KURUMI_BUCKET.get(objectKey);
			if (!object) {
				return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
			}

			return new Response(object.body, {
				headers: {
					...CORS_HEADERS,
					'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
					ETag: object.httpEtag
				}
			});
		}

		// Handle PUT - Upload document or blob object
		if (request.method === 'PUT') {
			const body = await request.arrayBuffer();
			await env.KURUMI_BUCKET.put(objectKey, body, {
				httpMetadata: {
					contentType: request.headers.get('Content-Type') || 'application/octet-stream'
				}
			});

			return new Response('OK', { status: 200, headers: CORS_HEADERS });
		}

		return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
	}
};
