/**
 * Browser notifications for due action items.
 *
 * The goal is zero-surprise: the user explicitly enables notifications
 * in settings, we ask for permission once, and then periodically check
 * the action items store for things due today or earlier that we
 * haven't already notified about in this session.
 *
 * Dedup is session-scoped on purpose — we don't want to spam the user
 * on every tab focus, but we DO want to re-notify across sessions so
 * long-lived overdue items keep surfacing.
 */

import { get } from 'svelte/store';
import { actionItems, todayIso } from '$lib/db';
import type { ActionItem } from '$lib/db/types';

const SETTINGS_KEY = 'kurumi-notifications-enabled';
const CHECK_INTERVAL_MS = 60_000; // Re-check every minute
const notifiedThisSession = new Set<string>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

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
}
