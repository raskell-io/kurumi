/**
 * Browser-app plumbing around the service worker: online state,
 * persistent storage, the app badge, the offline cache, and the
 * IndexedDB mailboxes the service worker fills while no page is open
 * (shared files from the share sheet, Mark done / Snooze taps on
 * notifications). static/sw-notify.js is the other side.
 */

import { readable } from 'svelte/store';

// ---------------------------------------------------------------- online

export const online = readable(true, (set) => {
	if (typeof window === 'undefined') return;
	set(navigator.onLine);
	const up = () => set(true);
	const down = () => set(false);
	window.addEventListener('online', up);
	window.addEventListener('offline', down);
	return () => {
		window.removeEventListener('online', up);
		window.removeEventListener('offline', down);
	};
});

// --------------------------------------------------------------- storage

/**
 * Ask the browser not to evict Kurumi's data under storage pressure.
 * Chrome decides silently (installed apps and engaged sites get it),
 * Firefox may prompt, Safari grants it to home-screen apps.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export interface StorageInfo {
	persisted: boolean | null;
	usage: number | null;
	quota: number | null;
}

export async function storageInfo(): Promise<StorageInfo> {
	const info: StorageInfo = { persisted: null, usage: null, quota: null };
	if (typeof navigator === 'undefined' || !navigator.storage) return info;
	try {
		info.persisted = (await navigator.storage.persisted?.()) ?? null;
		const estimate = await navigator.storage.estimate?.();
		info.usage = estimate?.usage ?? null;
		info.quota = estimate?.quota ?? null;
	} catch {
		// Leave unknowns as null.
	}
	return info;
}

// ----------------------------------------------------------------- badge

/** Number on the installed app's icon; 0 clears it. */
export function setAppBadge(count: number): void {
	if (typeof navigator === 'undefined') return;
	const nav = navigator as Navigator & {
		setAppBadge?: (n?: number) => Promise<void>;
		clearAppBadge?: () => Promise<void>;
	};
	if (!nav.setAppBadge) return;
	(count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge!()).catch(() => {});
}

// --------------------------------------------------------- offline cache

export interface OfflineInfo {
	/** A service worker controls this page: it loads without network. */
	ready: boolean;
	/** Files the service worker keeps for offline use (app + AI runtime). */
	cachedFiles: number;
	/** Downloaded on-device models (transformers.js cache entries). */
	modelFiles: number;
}

const MODEL_CACHE = 'transformers-cache';

export async function offlineInfo(): Promise<OfflineInfo> {
	const info: OfflineInfo = { ready: false, cachedFiles: 0, modelFiles: 0 };
	if (typeof navigator === 'undefined') return info;
	info.ready = !!navigator.serviceWorker?.controller;
	if (typeof caches === 'undefined') return info;
	try {
		for (const name of await caches.keys()) {
			const count = (await (await caches.open(name)).keys()).length;
			if (name === MODEL_CACHE) info.modelFiles += count;
			else info.cachedFiles += count;
		}
	} catch {
		// Cache storage unavailable (private mode); report what we have.
	}
	return info;
}

/**
 * Drop the app's offline copy and reload, which fetches and caches a
 * fresh one. Notes and downloaded models are untouched.
 */
export async function resetOfflineCache(): Promise<void> {
	try {
		const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
		await Promise.all(registrations.map((r) => r.unregister()));
		for (const name of await caches.keys()) {
			if (name !== MODEL_CACHE) await caches.delete(name);
		}
	} finally {
		location.reload();
	}
}

// ------------------------------------------------------------- mailboxes

// Shared with static/sw-notify.js: keep names and version in step.
export const SW_DB = 'kurumi-sw';
const SW_DB_VERSION = 1;
export const SW_STORES = ['shared', 'pending', 'snoozed'] as const;
type SwStore = (typeof SW_STORES)[number];

export interface SharedPayload {
	id: string;
	title: string;
	text: string;
	url: string;
	files: File[];
	receivedAt: number;
}

export interface PendingAction {
	id: string; // action item id
	action: 'done';
	at: number;
}

export interface Snooze {
	id: string; // action item id
	until: number;
}

function openSwDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(SW_DB, SW_DB_VERSION);
		req.onupgradeneeded = () => {
			for (const name of SW_STORES) {
				if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function withStore<T>(name: SwStore, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
	const db = await openSwDb();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const tx = db.transaction(name, mode);
			const req = run(tx.objectStore(name));
			tx.oncomplete = () => resolve(req ? req.result : undefined);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

/** Read everything in a mailbox and empty it. */
export async function takeAll<T>(name: 'shared' | 'pending'): Promise<T[]> {
	if (typeof indexedDB === 'undefined') return [];
	try {
		const items = (await withStore<T[]>(name, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
		if (items.length) await withStore(name, 'readwrite', (s) => void s.clear());
		return items;
	} catch {
		return [];
	}
}

export async function snoozes(): Promise<Snooze[]> {
	if (typeof indexedDB === 'undefined') return [];
	try {
		return (await withStore<Snooze[]>('snoozed', 'readonly', (s) => s.getAll() as IDBRequest<Snooze[]>)) ?? [];
	} catch {
		return [];
	}
}

export async function snooze(id: string, ms: number): Promise<void> {
	await withStore('snoozed', 'readwrite', (s) => void s.put({ id, until: Date.now() + ms } satisfies Snooze));
}
