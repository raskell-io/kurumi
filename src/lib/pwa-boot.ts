/**
 * App-start wiring for the installed-app features in $lib/pwa: storage
 * persistence, the icon badge, notification actions taken while the app
 * was closed, and markdown files opened with Kurumi.
 */

import { derived, get } from 'svelte/store';
import { goto } from '$app/navigation';
import { actionItems, completeRecurring, updateActionItemStatus, todayIso, type ActionItem } from '$lib/db';
import { myNames, isMine } from '$lib/work';
import { importMarkdownFile } from '$lib/incoming';
import { forgetNotified } from '$lib/notifications';
import { requestPersistentStorage, setAppBadge, takeAll, type PendingAction } from '$lib/pwa';

/** Your open to-dos due today or earlier. */
function countDue(items: ActionItem[], names: string[]): number {
	const today = todayIso();
	return items.filter(
		(a) => (a.status === 'open' || a.status === 'in_progress') && !!a.dueDate && a.dueDate.slice(0, 10) <= today && isMine(a.assignee, names)
	).length;
}

/** Apply Mark done taps the service worker queued from notifications. */
export async function applyPendingActions(): Promise<void> {
	const pending = await takeAll<PendingAction>('pending');
	const items = get(actionItems);
	for (const p of pending) {
		const item = items.find((a) => a.id === p.id);
		if (!item || item.status === 'done' || item.status === 'cancelled') continue;
		if (item.recurrence && item.recurrence !== 'none') completeRecurring(item.id);
		else updateActionItemStatus(item.id, 'done');
	}
}

type LaunchQueue = { setConsumer(consumer: (params: { files?: FileSystemFileHandle[] }) => void): void };

export function bootPwa(): () => void {
	void requestPersistentStorage();

	// Badge: refresh on changes, and every 10 minutes for the date rollover.
	const unsubBadge = derived([actionItems, myNames], ([$items, $names]) => countDue($items, $names)).subscribe(setAppBadge);
	const badgeTimer = setInterval(() => setAppBadge(countDue(get(actionItems), get(myNames))), 10 * 60 * 1000);

	void applyPendingActions();
	const onMessage = (event: MessageEvent) => {
		if (event.data?.type === 'kurumi-pending') void applyPendingActions();
		if (event.data?.type === 'kurumi-snoozed') forgetNotified(event.data.id);
	};
	navigator.serviceWorker?.addEventListener('message', onMessage);

	// Files opened with Kurumi (installed app, file_handlers in the manifest).
	const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
	launchQueue?.setConsumer(async ({ files }) => {
		if (!files?.length) return;
		const ids: string[] = [];
		for (const handle of files) {
			try {
				ids.push(await importMarkdownFile(await handle.getFile()));
			} catch (err) {
				console.error('Could not open file', handle.name, err);
			}
		}
		if (ids.length) goto(`/memory/${ids[0]}`, { replaceState: true });
	});

	return () => {
		unsubBadge();
		clearInterval(badgeTimer);
		navigator.serviceWorker?.removeEventListener('message', onMessage);
	};
}
