import { getDocBinary, mergeDoc } from '$lib/db';
import { setSyncing, setSyncSuccess, setSyncError } from './status';

const SYNC_URL_KEY = 'kurumi-sync-url';
const SYNC_TOKEN_KEY = 'kurumi-sync-token';

interface SyncConfig {
	url: string;
	token: string;
}

function getSyncConfig(): SyncConfig | null {
	if (typeof localStorage === 'undefined') return null;

	const url = localStorage.getItem(SYNC_URL_KEY);
	const token = localStorage.getItem(SYNC_TOKEN_KEY);

	if (!url || !token) return null;
	return { url, token };
}

export function isSyncConfigured(): boolean {
	const config = getSyncConfig();
	return config !== null && config.url.length > 0 && config.token.length > 0;
}

export async function testConnection(): Promise<{ success: boolean; error?: string }> {
	const config = getSyncConfig();
	if (!config) {
		return { success: false, error: 'Sync not configured' };
	}

	try {
		const response = await fetch(config.url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${config.token}`
			}
		});

		if (response.ok || response.status === 404) {
			// 404 is OK - means no remote doc yet
			return { success: true };
		}

		if (response.status === 401 || response.status === 403) {
			return { success: false, error: 'Invalid authentication token' };
		}

		return { success: false, error: `Server returned ${response.status}` };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Network error';
		return { success: false, error: message };
	}
}

async function pullRemote(config: SyncConfig): Promise<Uint8Array | null> {
	const response = await fetch(config.url, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${config.token}`
		}
	});

	if (response.status === 404) {
		// No remote document yet
		return null;
	}

	if (!response.ok) {
		throw new Error(`Pull failed: ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	return new Uint8Array(arrayBuffer);
}

async function pushToRemote(config: SyncConfig, binary: Uint8Array): Promise<void> {
	// Create a clean ArrayBuffer copy for fetch body
	const buffer = new ArrayBuffer(binary.length);
	new Uint8Array(buffer).set(binary);

	const response = await fetch(config.url, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${config.token}`,
			'Content-Type': 'application/octet-stream'
		},
		body: buffer
	});

	if (!response.ok) {
		throw new Error(`Push failed: ${response.status}`);
	}
}

export async function sync(): Promise<{ success: boolean; error?: string }> {
	const config = getSyncConfig();
	if (!config) {
		return { success: false, error: 'Sync not configured' };
	}

	setSyncing();

	try {
		// Step 1: Pull remote document
		const remoteBinary = await pullRemote(config);

		// Step 2: Merge if remote exists
		if (remoteBinary !== null) {
			await mergeDoc(remoteBinary);
		}

		// Step 3: Get merged local state and push
		const localBinary = getDocBinary();
		await pushToRemote(config, localBinary);

		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed';
		setSyncError(message);
		return { success: false, error: message };
	}
}
