/**
 * Browser notifications for due action items.
 *
 * There are two layers here:
 *
 * 1. In-tab loop: while the app is open, a setInterval polls the
 *    actionItems store every minute and fires a Notification for
 *    any open / in-progress item whose dueDate has arrived. Dedup
 *    is session-scoped so tab focus doesn't spam the user.
 *
 * 2. Background periodic-sync: when the PWA is installed and the
 *    user opts in, we register a `kurumi-due-check` periodicsync
 *    tag with the service worker. The SW (static/sw-notify.js) then
 *    runs even when the tab is closed and shows notifications based
 *    on a cached snapshot of due items that this module writes to
 *    IndexedDB whenever the action-items store changes.
 *
 * The two layers are independent — layer 1 works everywhere without
 * any permissions beyond Notification.permission, layer 2 requires
 * the PWA to be installed AND periodicsync to be supported AND the
 * browser's site-permissions to allow it (currently Chromium only).
 */

import { get } from 'svelte/store';
import { actionItems, todayIso } from '$lib/db';
import type { ActionItem } from '$lib/db/types';

const SETTINGS_KEY = 'kurumi-notifications-enabled';
const BACKGROUND_SETTINGS_KEY = 'kurumi-background-notifications-enabled';
const PERIODIC_SYNC_TAG = 'kurumi-due-check';
const DUE_CACHE_DB = 'kurumi-due-cache';
const DUE_CACHE_STORE = 'due';
// 12 hours — the minimum that Chrome will actually honour for
// periodicsync without being considered an abusive site. In practice
// Chrome decides the real interval based on site engagement signals,
// so this is a floor not a ceiling.
const PERIODIC_SYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60_000; // Re-check every minute
const notifiedThisSession = new Set<string>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let cacheUnsub: (() => void) | null = null;

export function notificationsSupported(): boolean {
	return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission {
	if (!notificationsSupported()) return 'denied';
	return Notification.permission;
}

export function notificationsEnabled(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(SETTINGS_KEY) === 'true';
}

export function setNotificationsEnabled(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(SETTINGS_KEY, enabled ? 'true' : 'false');
	if (enabled) startNotificationLoop();
	else stopNotificationLoop();
}

/**
 * Ask for permission if not already decided. Resolves to the final
 * permission state (granted / denied / default).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!notificationsSupported()) return 'denied';
	if (Notification.permission === 'granted') return 'granted';
	if (Notification.permission === 'denied') return 'denied';
	try {
		return await Notification.requestPermission();
	} catch {
		return 'denied';
	}
}

function itemIsDueNow(item: ActionItem, today: string): boolean {
	if (item.status !== 'open' && item.status !== 'in_progress') return false;
	if (!item.dueDate) return false;
	return item.dueDate <= today;
}

/**
 * Walk the current action items and fire a notification for anything
 * due that hasn't been shown yet this session. Called both immediately
 * on loop start and on a timer.
 */
function checkAndNotify(): void {
	if (!notificationsSupported()) return;
	if (Notification.permission !== 'granted') return;
	if (!notificationsEnabled()) return;

	const today = todayIso();
	const items = get(actionItems);
	for (const item of items) {
		if (!itemIsDueNow(item, today)) continue;
		if (notifiedThisSession.has(item.id)) continue;
		notifiedThisSession.add(item.id);

		const isOverdue = item.dueDate !== null && item.dueDate < today;
		try {
			const notification = new Notification(
				isOverdue ? 'Overdue: Kurumi action item' : 'Due today: Kurumi action item',
				{
					body: item.text,
					tag: `kurumi-action-${item.id}`,
					icon: '/icon-192.png'
				}
			);
			notification.onclick = () => {
				window.focus();
				window.location.hash = '#/actions';
				notification.close();
			};
		} catch {
			// Some browsers throw if Notification is used outside a user gesture;
			// safe to ignore since we'll retry on the next tick.
		}
	}
}

export function startNotificationLoop(): void {
	if (intervalHandle !== null) return;
	checkAndNotify();
	intervalHandle = setInterval(checkAndNotify, CHECK_INTERVAL_MS);
}

export function stopNotificationLoop(): void {
	if (intervalHandle !== null) {
		clearInterval(intervalHandle);
		intervalHandle = null;
	}
}

/**
 * Boot helper: if the user previously enabled notifications and
 * permission is still granted, restart the loop on app load. Call from
 * the root layout's onMount.
 */
export function bootNotifications(): void {
	if (!notificationsSupported()) return;
	if (!notificationsEnabled()) return;
	if (Notification.permission !== 'granted') return;
	startNotificationLoop();
	// Also keep the background-sync due cache in step with the store
	// so the service worker has something to read when periodicsync
	// fires. This is safe even if the user hasn't enabled background
	// notifications yet — the SW will simply read from an empty store.
	startDueCacheSync();
	if (backgroundNotificationsEnabled()) {
		void ensurePeriodicSyncRegistered();
	}
}

// ---------------------------------------------------------------------------
// Background-sync layer: due-items IndexedDB cache + periodicsync register
// ---------------------------------------------------------------------------

export function backgroundNotificationsEnabled(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(BACKGROUND_SETTINGS_KEY) === 'true';
}

export function setBackgroundNotificationsEnabled(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(BACKGROUND_SETTINGS_KEY, enabled ? 'true' : 'false');
}

/**
 * Feature-detect periodicsync support. Chrome/Edge have it; Firefox
 * and Safari don't. Even on Chrome it only works when the PWA is
 * installed and the site has enough engagement signal.
 */
export async function periodicSyncSupported(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	try {
		const reg = await navigator.serviceWorker.ready;
		return 'periodicSync' in reg;
	} catch {
		return false;
	}
}

interface DueCacheItem {
	id: string;
	text: string;
	dueDate: string;
	status: string;
}

/** Open the dedicated due-cache IndexedDB. Kept separate from the main
 * Automerge store so the service worker can read it without dragging
 * in the Automerge runtime. */
function openDueCache(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DUE_CACHE_DB, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(DUE_CACHE_STORE)) {
				db.createObjectStore(DUE_CACHE_STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Replace the entire contents of the due-cache with the given items.
 * Easier than diffing — the cache is small (just open items) and the
 * main-thread write happens at most once per action-items-store change. */
async function writeDueCache(items: DueCacheItem[]): Promise<void> {
	try {
		const db = await openDueCache();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(DUE_CACHE_STORE, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			const store = tx.objectStore(DUE_CACHE_STORE);
			store.clear();
			for (const item of items) {
				store.put(item);
			}
		});
	} catch {
		// Best effort — a failed cache write just means the SW won't
		// have anything to notify about on the next periodicsync.
	}
}

function itemToCacheEntry(item: ActionItem): DueCacheItem | null {
	if (item.status !== 'open' && item.status !== 'in_progress') return null;
	if (!item.dueDate) return null;
	return {
		id: item.id,
		text: item.text,
		dueDate: item.dueDate,
		status: item.status
	};
}

/**
 * Subscribe to the action-items store and mirror all open / in-progress
 * items with a dueDate into the due-cache IndexedDB store. The service
 * worker reads this cache on periodicsync.
 */
export function startDueCacheSync(): void {
	if (cacheUnsub) return;
	if (typeof indexedDB === 'undefined') return;
	cacheUnsub = actionItems.subscribe((items) => {
		const entries = items
			.map((i) => itemToCacheEntry(i))
			.filter((e): e is DueCacheItem => e !== null);
		void writeDueCache(entries);
	});
}

export function stopDueCacheSync(): void {
	if (cacheUnsub) {
		cacheUnsub();
		cacheUnsub = null;
	}
}

/**
 * Register (or re-register) the kurumi-due-check periodicsync tag
 * with the service worker. Resolves to true on success, false on
 * feature/permission failure.
 */
export async function ensurePeriodicSyncRegistered(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	try {
		const reg = await navigator.serviceWorker.ready;
		if (!('periodicSync' in reg)) return false;
		const periodicSync = (reg as ServiceWorkerRegistration & {
			periodicSync: {
				register(tag: string, options: { minInterval: number }): Promise<void>;
				getTags(): Promise<string[]>;
				unregister(tag: string): Promise<void>;
			};
		}).periodicSync;

		const existing = await periodicSync.getTags();
		if (existing.includes(PERIODIC_SYNC_TAG)) {
			// Already registered — nothing to do.
			return true;
		}
		await periodicSync.register(PERIODIC_SYNC_TAG, {
			minInterval: PERIODIC_SYNC_MIN_INTERVAL_MS
		});
		return true;
	} catch {
		return false;
	}
}

export async function unregisterPeriodicSync(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	try {
		const reg = await navigator.serviceWorker.ready;
		if (!('periodicSync' in reg)) return;
		const periodicSync = (reg as ServiceWorkerRegistration & {
			periodicSync: {
				getTags(): Promise<string[]>;
				unregister(tag: string): Promise<void>;
			};
		}).periodicSync;
		const existing = await periodicSync.getTags();
		if (existing.includes(PERIODIC_SYNC_TAG)) {
			await periodicSync.unregister(PERIODIC_SYNC_TAG);
		}
	} catch {
		// Ignore — unregistration is best effort.
	}
}
