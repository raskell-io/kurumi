/**
 * Optional end-to-end encryption for the object-storage sync methods
 * (Kurumi sync server / R2, S3, WebDAV, Azure): the database and every
 * blob are sealed with a key derived from a passphrase only the user's
 * devices know, so the storage provider holds ciphertext.
 *
 * Envelope: "KRMENC01" | salt (16) | iv (12) | AES-256-GCM ciphertext+tag.
 * The key is PBKDF2-SHA-256 (600k iterations) of the passphrase and the
 * salt. Devices converge on the salt of the first sealed copy they read,
 * so one passphrase opens everything. Derived keys are kept per device in
 * IndexedDB as non-extractable CryptoKeys; the passphrase itself is only
 * held in memory until it has been used. Whether to seal is a setting in
 * the synced document (`syncEncrypted`), so turning it on or off on one
 * device switches all of them instead of devices re-sealing each other's
 * readable uploads.
 *
 * Git and the local folder mirror stay plain markdown by design (and the
 * local git agent merges the folder's binary), so they aren't sealed.
 */

import { get as idbGet, set as idbSet } from 'idb-keyval';
import { getSyncEncrypted, setSyncEncrypted } from '$lib/db';
import type { ObjectTransport } from './blobs';

const MAGIC = new TextEncoder().encode('KRMENC01');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ITERATIONS = 600_000;

const KEYS_KEY = 'kurumi-sync-keys'; // IndexedDB: { salt: hex, keys: { [saltHex]: CryptoKey } }

export class SyncLockedError extends Error {
	constructor() {
		super('The synced copy is encrypted. Enter its passphrase in Settings → Sync.');
		this.name = 'SyncLockedError';
	}
}

export class WrongPassphraseError extends Error {
	constructor() {
		super("The passphrase doesn't open the synced copy.");
		this.name = 'WrongPassphraseError';
	}
}

/** Whether a sync error message is one of the above (shown with a passphrase field). */
export function isLockMessage(message: string | null | undefined): boolean {
	return !!message && (message === new SyncLockedError().message || message === new WrongPassphraseError().message);
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------ primitives

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export function isSealed(bytes: Uint8Array): boolean {
	return bytes.length > MAGIC.length + SALT_BYTES + IV_BYTES && MAGIC.every((b, i) => bytes[i] === b);
}

/** The salt a sealed copy was made with. */
export function saltOf(bytes: Uint8Array): Uint8Array {
	return bytes.slice(MAGIC.length, MAGIC.length + SALT_BYTES);
}

export async function sealWith(key: CryptoKey, salt: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
	const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + cipher.length);
	out.set(MAGIC, 0);
	out.set(salt, MAGIC.length);
	out.set(iv, MAGIC.length + SALT_BYTES);
	out.set(cipher, MAGIC.length + SALT_BYTES + IV_BYTES);
	return out;
}

export async function openWith(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
	const ivStart = MAGIC.length + SALT_BYTES;
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sealed.slice(ivStart, ivStart + IV_BYTES) },
			key,
			sealed.slice(ivStart + IV_BYTES) as BufferSource
		);
		return new Uint8Array(plain);
	} catch {
		throw new WrongPassphraseError();
	}
}

// ------------------------------------------------------------ device state

interface KeyRing {
	salt: string | null; // the salt this device seals with
	keys: Record<string, CryptoKey>;
}

let pendingPassphrase: string | null = null;

async function ring(): Promise<KeyRing> {
	return (await idbGet<KeyRing>(KEYS_KEY)) ?? { salt: null, keys: {} };
}

export function encryptionEnabled(): boolean {
	return getSyncEncrypted();
}

/** Whether this device holds a key (it can read sealed copies). */
export async function hasSyncKey(): Promise<boolean> {
	return Object.keys((await ring()).keys).length > 0;
}

/**
 * Turn encryption on with a passphrase: a fresh salt and key, so a new
 * passphrase really replaces the old one (old keys stay, to read copies
 * sealed before). Joining an already encrypted copy switches to its salt
 * once the passphrase has opened it.
 */
export async function enableEncryption(passphrase: string): Promise<void> {
	if (passphrase.length < 8) throw new Error('Use at least 8 characters.');
	pendingPassphrase = passphrase;
	const r = await ring();
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	r.salt = hex(salt);
	r.keys[r.salt] = await deriveKey(passphrase, salt);
	await idbSet(KEYS_KEY, r);
	setSyncEncrypted(true);
}

/** Provide the passphrase for an encrypted copy without changing anything else. */
export function unlockSync(passphrase: string): void {
	pendingPassphrase = passphrase;
}

/**
 * Stop sealing on every device: the next sync uploads a readable copy.
 * This device keeps its key, so it can still open the sealed copy that's
 * there now.
 */
export async function disableEncryption(): Promise<void> {
	pendingPassphrase = null;
	setSyncEncrypted(false);
}

/** Seal before upload (no-op when encryption is off). */
export async function sealForSync(plain: Uint8Array): Promise<Uint8Array> {
	if (!encryptionEnabled()) return plain;
	const r = await ring();
	if (!r.salt || !r.keys[r.salt]) throw new SyncLockedError();
	const salt = Uint8Array.from(r.salt.match(/../g)!.map((h) => parseInt(h, 16)));
	return sealWith(r.keys[r.salt], salt, plain);
}

/** Open after download; plain copies pass through. */
export async function openFromSync(bytes: Uint8Array): Promise<Uint8Array> {
	if (!isSealed(bytes)) return bytes;
	const saltBytes = saltOf(bytes);
	const salt = hex(saltBytes);
	const r = await ring();
	// A passphrase just entered wins over a stored key, and its key is only
	// kept once it has opened the copy: a typo must not lock the device out.
	if (pendingPassphrase) {
		const key = await deriveKey(pendingPassphrase, saltBytes);
		const plain = await openWith(key, bytes).catch(() => null);
		if (plain) {
			pendingPassphrase = null;
			r.keys[salt] = key;
			r.salt = salt; // converge on the copy's salt, so every device seals alike
			await idbSet(KEYS_KEY, r);
			return plain;
		}
		// Not this copy's passphrase. A key this device already has for it
		// (a copy sealed before a passphrase change) still opens it;
		// otherwise the passphrase is wrong.
		if (!r.keys[salt]) {
			pendingPassphrase = null;
			throw new WrongPassphraseError();
		}
	}
	const key = r.keys[salt];
	if (!key) throw new SyncLockedError();
	const plain = await openWith(key, bytes);
	if (r.salt !== salt) {
		r.salt = salt;
		await idbSet(KEYS_KEY, r);
	}
	return plain;
}

/** Blob transport that seals what it uploads and opens what it downloads. */
export function encryptingTransport(transport: ObjectTransport): ObjectTransport {
	return {
		get: async (key) => {
			const data = await transport.get(key);
			return data ? openFromSync(data) : data;
		},
		put: async (key, data, contentType) => {
			const sealed = await sealForSync(data);
			await transport.put(key, sealed, sealed === data ? contentType : 'application/octet-stream');
		}
	};
}
