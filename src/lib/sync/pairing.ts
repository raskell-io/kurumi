/**
 * Pairing a device with a Kurumi sync server (the Cloudflare Worker in
 * `worker/`): a link carrying the server URL and its token, opened on the
 * new device, sets sync up in one step. The server's setup page makes the
 * first link; Settings → Sync → "Add a device" makes the next ones.
 *
 *   https://kurumi.raskell.io/#/settings/sync?pair=<base64url JSON {url, token}>
 *
 * The link is a credential: whoever opens it can sync with the server
 * (and, without encryption, read the notes). The passphrase is never in it.
 */

import { setSyncMethod } from './service';

export interface Pairing {
	url: string;
	token: string;
}

const toBase64Url = (s: string) =>
	btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string) =>
	new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function encodePairing(pairing: Pairing): string {
	return toBase64Url(JSON.stringify({ url: pairing.url, token: pairing.token }));
}

/** The pairing in a `pair` parameter, or null if it isn't one. */
export function decodePairing(code: string): Pairing | null {
	try {
		const value = JSON.parse(fromBase64Url(code));
		if (typeof value?.url !== 'string' || typeof value?.token !== 'string') return null;
		const url = new URL(value.url);
		if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
		return { url: url.toString(), token: value.token };
	} catch {
		return null;
	}
}

/** A link that sets up another device with this device's sync server, or null. */
export function pairingLinkForThisDevice(appOrigin = location.origin): string | null {
	const url = localStorage.getItem('kurumi-sync-url');
	const token = localStorage.getItem('kurumi-sync-token');
	if (!url || !token) return null;
	return `${appOrigin}/#/settings/sync?pair=${encodePairing({ url, token })}`;
}

/** Use the server from a pairing link as this device's sync. */
export function applyPairing(pairing: Pairing): void {
	localStorage.setItem('kurumi-sync-url', pairing.url);
	localStorage.setItem('kurumi-sync-token', pairing.token);
	setSyncMethod('r2');
}
