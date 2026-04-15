import { writable, derived } from 'svelte/store';

const PIN_HASH_KEY = 'kurumi-pin-hash';
const LOCK_ENABLED_KEY = 'kurumi-lock-enabled';
const AUTO_LOCK_KEY = 'kurumi-auto-lock-minutes';

/**
 * Simple hash for PIN storage. Not cryptographically strong but
 * sufficient for a local-only app lock (the data is already on the
 * user's device).
 */
async function hashPin(pin: string): Promise<string> {
	const data = new TextEncoder().encode(pin + 'kurumi-salt');
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export const isLocked = writable(false);
export const lockEnabled = writable(
	typeof localStorage !== 'undefined' && localStorage.getItem(LOCK_ENABLED_KEY) === 'true'
);
export const autoLockMinutes = writable(
	typeof localStorage !== 'undefined'
		? parseInt(localStorage.getItem(AUTO_LOCK_KEY) || '5', 10)
		: 5
);

export function hasPinSet(): boolean {
	return typeof localStorage !== 'undefined' && !!localStorage.getItem(PIN_HASH_KEY);
}

export async function setPin(pin: string): Promise<void> {
	const hash = await hashPin(pin);
	localStorage.setItem(PIN_HASH_KEY, hash);
	localStorage.setItem(LOCK_ENABLED_KEY, 'true');
	lockEnabled.set(true);
}

export async function verifyPin(pin: string): Promise<boolean> {
	const stored = localStorage.getItem(PIN_HASH_KEY);
	if (!stored) return false;
	const hash = await hashPin(pin);
	return hash === stored;
}

export function removePin(): void {
	localStorage.removeItem(PIN_HASH_KEY);
	localStorage.setItem(LOCK_ENABLED_KEY, 'false');
	lockEnabled.set(false);
	isLocked.set(false);
}

export function lock(): void {
	isLocked.set(true);
}

export async function unlock(pin: string): Promise<boolean> {
	const ok = await verifyPin(pin);
	if (ok) isLocked.set(false);
	return ok;
}

export function setAutoLockMinutes(minutes: number): void {
	autoLockMinutes.set(minutes);
	localStorage.setItem(AUTO_LOCK_KEY, String(minutes));
}
