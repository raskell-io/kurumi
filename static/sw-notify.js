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
 *   2. A notificationclick handler. Mark done / Snooze 1h are queued in
 *      the kurumi-sw IndexedDB (src/lib/pwa.ts reads it) and open pages
 *      are told; a plain click focuses Kurumi on /#/actions.
 *
 *   3. The share target: files and text shared to the installed app
 *      arrive as a POST to /share-target, are stashed in kurumi-sw and
 *      the app opens on /?share=incoming to turn them into notes.
 *
 *   4. The app icon badge: your due / overdue to-dos.
 *
 * Intentionally no Workbox imports here — everything is plain SW +
 * IndexedDB APIs so this file stays decoupled from the generateSW
 * pipeline.
 */

/* global self, indexedDB, clients */

const DUE_CACHE_DB = 'kurumi-due-cache';
const DUE_CACHE_STORE = 'due';
const ACTIONS_URL = '/#/actions';
const SNOOZE_MS = 60 * 60 * 1000;

// Mailboxes shared with src/lib/pwa.ts: keep names and version in step.
const SW_DB = 'kurumi-sw';
const SW_STORES = ['shared', 'pending', 'snoozed'];

function openSwDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(SW_DB, 1);
		req.onupgradeneeded = () => {
			for (const name of SW_STORES) {
				if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function swStore(name, mode, run) {
	const db = await openSwDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(name, mode);
			const req = run(tx.objectStore(name));
			tx.oncomplete = () => resolve(req ? req.result : undefined);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

const readAll = (name) => swStore(name, 'readonly', (s) => s.getAll()).catch(() => []);

async function tellPages(message) {
	for (const client of await clients.matchAll({ type: 'window', includeUncontrolled: true })) {
		client.postMessage(message);
	}
}

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

// Due / overdue items, minus those marked done from a notification
// that the app hasn't applied yet.
async function dueItems() {
	const today = todayIso();
	const done = new Set((await readAll('pending')).map((p) => p.id));
	return (await readDueCache()).filter((item) => item.dueDate && item.dueDate <= today && !done.has(item.id));
}

async function refreshBadge(due) {
	if (!self.navigator.setAppBadge) return;
	const mine = (due || (await dueItems())).filter((item) => item.mine !== false).length;
	await (mine ? self.navigator.setAppBadge(mine) : self.navigator.clearAppBadge()).catch(() => {});
}

async function checkAndNotify() {
	const today = todayIso();
	const now = Date.now();
	const snoozed = new Set((await readAll('snoozed')).filter((s) => s.until > now).map((s) => s.id));
	const due = await dueItems();
	await refreshBadge(due);

	for (const item of due) {
		if (snoozed.has(item.id)) continue;
		const overdue = item.dueDate < today;
		try {
			await self.registration.showNotification(
				overdue ? 'Overdue to-do' : 'To-do due today',
				{
					body: item.text,
					tag: `kurumi-action-${item.id}`,
					icon: '/icon-192.png',
					data: { actionItemId: item.id },
					actions: [
						{ action: 'done', title: 'Mark done' },
						{ action: 'snooze', title: 'Snooze 1h' }
					]
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
	const id = event.notification.data && event.notification.data.actionItemId;
	if (id && event.action === 'done') {
		event.waitUntil(
			(async () => {
				await swStore('pending', 'readwrite', (s) => void s.put({ id, action: 'done', at: Date.now() }));
				await tellPages({ type: 'kurumi-pending' });
				await refreshBadge();
			})()
		);
		return;
	}
	if (id && event.action === 'snooze') {
		event.waitUntil(
			(async () => {
				await swStore('snoozed', 'readwrite', (s) => void s.put({ id, until: Date.now() + SNOOZE_MS }));
				await tellPages({ type: 'kurumi-snoozed', id });
			})()
		);
		return;
	}
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

// Share target (manifest share_target, POST multipart). Registered here,
// before Workbox's routes, so the POST never reaches the network.
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share-target') return;
	event.respondWith(
		(async () => {
			try {
				const form = await event.request.formData();
				const text = (key) => {
					const value = form.get(key);
					return typeof value === 'string' ? value : '';
				};
				await swStore('shared', 'readwrite', (s) =>
					void s.put({
						id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
						title: text('share_title'),
						text: text('share_text'),
						url: text('share_url'),
						files: form.getAll('share_files').filter((f) => typeof f !== 'string'),
						receivedAt: Date.now()
					})
				);
			} catch (err) {
				console.error('[kurumi] share target failed', err);
			}
			return Response.redirect('/?share=incoming', 303);
		})()
	);
});
