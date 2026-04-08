/**
 * Kurumi service-worker additions: background-sync notifications.
 *
 * This file is included via workbox.importScripts in vite.config.ts
 * and runs inside the generated Workbox service worker's global
 * scope. It adds:
 *
 *   1. A periodicsync handler that fires on the 'kurumi-due-check'
 *      tag. Reads the due-items cache from IndexedDB (maintained by
 *      the main thread in $lib/notifications.ts) and shows a browser
 *      notification for each due / overdue action item.
 *
 *   2. A notificationclick handler that focuses an existing Kurumi
 *      tab if one is open, or opens a new one pointing at /#/actions.
 *
 * Intentionally no Workbox imports here — everything is plain SW +
 * IndexedDB APIs so this file stays decoupled from the generateSW
 * pipeline.
 */

/* global self, indexedDB, clients */

const DUE_CACHE_DB = 'kurumi-due-cache';
const DUE_CACHE_STORE = 'due';
const ACTIONS_URL = '/#/actions';

function todayIso() {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function openDueCache() {
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

async function readDueCache() {
	try {
		const db = await openDueCache();
		return await new Promise((resolve) => {
			const tx = db.transaction(DUE_CACHE_STORE, 'readonly');
			const store = tx.objectStore(DUE_CACHE_STORE);
			const req = store.getAll();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => resolve([]);
		});
	} catch {
		return [];
	}
}

async function checkAndNotify() {
	const items = await readDueCache();
	const today = todayIso();
	for (const item of items) {
		if (!item.dueDate || item.dueDate > today) continue;
		const overdue = item.dueDate < today;
		try {
			await self.registration.showNotification(
				overdue ? 'Overdue: Kurumi action item' : 'Due today: Kurumi action item',
				{
					body: item.text,
					tag: `kurumi-action-${item.id}`,
					icon: '/icon-192.png',
					data: { actionItemId: item.id }
				}
			);
		} catch {
			// Notification API can reject in some contexts; continue with
			// the next item rather than bailing on the whole batch.
		}
	}
}

self.addEventListener('periodicsync', (event) => {
	if (event.tag === 'kurumi-due-check') {
		event.waitUntil(checkAndNotify());
	}
});

// Optional: one-shot background sync triggered when connectivity
// returns, used as a fallback on browsers that throttle periodicsync
// aggressively or for manual triggering from the main thread.
self.addEventListener('sync', (event) => {
	if (event.tag === 'kurumi-due-check') {
		event.waitUntil(checkAndNotify());
	}
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			const allClients = await clients.matchAll({
				type: 'window',
				includeUncontrolled: true
			});
			for (const client of allClients) {
				if ('focus' in client) {
					try {
						await client.focus();
					} catch {
						// ignore
					}
					if ('navigate' in client) {
						try {
							await client.navigate(ACTIONS_URL);
						} catch {
							// ignore
						}
					}
					return;
				}
			}
			await clients.openWindow(ACTIONS_URL);
		})()
	);
});
