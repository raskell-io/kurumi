import { writable, type Readable } from 'svelte/store';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncState {
	status: SyncStatus;
	lastSyncedAt: number | null;
	error: string | null;
}

const LAST_SYNC_KEY = 'kurumi-last-sync';

const initialState: SyncState = {
	status: 'idle',
	lastSyncedAt: null,
	error: null
};

export const syncState = writable<SyncState>(initialState);

export function setSyncing(): void {
	syncState.update((s) => ({ ...s, status: 'syncing', error: null }));
}

export function setSyncSuccess(): void {
	const timestamp = Date.now();
	syncState.update((s) => ({ ...s, status: 'success', lastSyncedAt: timestamp, error: null }));
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(LAST_SYNC_KEY, String(timestamp));
	}
}

export function setSyncError(error: string): void {
	syncState.update((s) => ({ ...s, status: 'error', error }));
}

export function setSyncIdle(): void {
	syncState.update((s) => ({ ...s, status: 'idle' }));
}

export function initSyncState(): void {
	if (typeof localStorage !== 'undefined') {
		const lastSync = localStorage.getItem(LAST_SYNC_KEY);
		if (lastSync) {
			syncState.update((s) => ({ ...s, lastSyncedAt: parseInt(lastSync, 10) }));
		}
	}
}
