import {
	getDocBinary,
	mergeDoc,
	memoryObjects,
	folders,
	vaults,
	currentVaultId,
	people,
	events,
	actionItems
} from '$lib/db';
import { setSyncing, setSyncSuccess, setSyncError, syncState } from './status';
import { get } from 'svelte/store';
import {
	isGitSyncConfigured,
	gitSyncState,
	syncGit,
	testGitConnection as testGitConnectionService
} from '$lib/git';
import {
	getS3Config,
	isS3Configured,
	s3Pull,
	s3Push,
	s3Test
} from './s3';
import {
	getWebDAVConfig,
	isWebDAVConfigured,
	webdavPull,
	webdavPush,
	webdavTest
} from './webdav';
import {
	hasLocalFSHandle,
	isLocalFSConfiguredSync,
	localFSPull,
	localFSPush,
	localFSTest
} from './local-fs';
import {
	getAzureBlobConfig,
	isAzureBlobConfigured,
	azureBlobPull,
	azureBlobPush,
	azureBlobTest
} from './azure-blob';
import type { MemoryObject, Folder, Person, Event, ActionItem } from '$lib/db/types';

const SYNC_URL_KEY = 'kurumi-sync-url';
const SYNC_TOKEN_KEY = 'kurumi-sync-token';
const SYNC_METHOD_KEY = 'kurumi-sync-method';
const MIRROR_METHODS_KEY = 'kurumi-sync-mirrors';
const MIN_SYNC_INTERVAL_MS = 10000;

export type SyncMethod = 'r2' | 'git' | 's3' | 'webdav' | 'local-fs' | 'azure-blob' | null;

interface SyncConfig {
	url: string;
	token: string;
}

/**
 * Get the current sync method
 */
const ALL_SYNC_METHODS: SyncMethod[] = ['r2', 'git', 's3', 'webdav', 'local-fs', 'azure-blob'];

export function getSyncMethod(): SyncMethod {
	if (typeof localStorage === 'undefined') return null;
	const method = localStorage.getItem(SYNC_METHOD_KEY);
	if (method && ALL_SYNC_METHODS.includes(method as SyncMethod)) return method as SyncMethod;
	// Auto-detect from configured providers
	if (getSyncConfig()) return 'r2';
	if (isGitSyncConfigured()) return 'git';
	if (isS3Configured()) return 's3';
	if (isWebDAVConfigured()) return 'webdav';
	if (isAzureBlobConfigured()) return 'azure-blob';
	return null;
}

/**
 * Mirror methods: other sync targets that receive a copy of the
 * primary's state after every successful sync. Stored as a JSON
 * array in localStorage.
 */
export function getMirrorMethods(): SyncMethod[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(MIRROR_METHODS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((m: unknown) => ALL_SYNC_METHODS.includes(m as SyncMethod))
			: [];
	} catch {
		return [];
	}
}

export function setMirrorMethods(methods: SyncMethod[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(MIRROR_METHODS_KEY, JSON.stringify(methods));
}

/**
 * Set the sync method
 */
export function setSyncMethod(method: SyncMethod): void {
	if (typeof localStorage === 'undefined') return;
	if (method) {
		localStorage.setItem(SYNC_METHOD_KEY, method);
	} else {
		localStorage.removeItem(SYNC_METHOD_KEY);
	}
}

function getSyncConfig(): SyncConfig | null {
	if (typeof localStorage === 'undefined') return null;

	const url = localStorage.getItem(SYNC_URL_KEY);
	const token = localStorage.getItem(SYNC_TOKEN_KEY);

	if (!url || !token) return null;
	return { url, token };
}

export function isR2SyncConfigured(): boolean {
	const config = getSyncConfig();
	return config !== null && config.url.length > 0 && config.token.length > 0;
}

export function isMethodConfigured(method: SyncMethod): boolean {
	switch (method) {
		case 'r2': return isR2SyncConfigured();
		case 'git': return isGitSyncConfigured();
		case 's3': return isS3Configured();
		case 'webdav': return isWebDAVConfigured();
		case 'local-fs': return isLocalFSConfiguredSync();
		case 'azure-blob': return isAzureBlobConfigured();
		default: return false;
	}
}

export function isSyncConfigured(): boolean {
	const method = getSyncMethod();
	if (method) return isMethodConfigured(method);
	return isR2SyncConfigured() || isGitSyncConfigured() || isS3Configured() ||
		isWebDAVConfigured() || isAzureBlobConfigured();
}

export async function testS3Connection(): Promise<{ success: boolean; error?: string }> {
	const config = getS3Config();
	if (!config) return { success: false, error: 'S3 not configured' };
	return s3Test(config);
}

export async function testWebDAVConnection(): Promise<{ success: boolean; error?: string }> {
	const config = getWebDAVConfig();
	if (!config) return { success: false, error: 'WebDAV not configured' };
	return webdavTest(config);
}

export async function testLocalFSConnection(): Promise<{ success: boolean; error?: string; folder?: string }> {
	return localFSTest();
}

export async function testAzureBlobConnection(): Promise<{ success: boolean; error?: string }> {
	const config = getAzureBlobConfig();
	if (!config) return { success: false, error: 'Azure Blob not configured' };
	return azureBlobTest(config);
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

/**
 * R2 sync implementation
 */
async function syncR2(): Promise<{ success: boolean; error?: string }> {
	const config = getSyncConfig();
	if (!config) {
		return { success: false, error: 'R2 sync not configured' };
	}

	setSyncing();

	try {
		// Step 1: Pull remote document
		let remoteBinary: Uint8Array | null;
		try {
			remoteBinary = await pullRemote(config);
		} catch (pullErr) {
			const message = pullErr instanceof Error ? pullErr.message : 'Failed to pull';
			setSyncError(`Pull failed: ${message}`);
			return { success: false, error: `Pull failed: ${message}` };
		}

		// Step 2: Merge if remote exists
		if (remoteBinary !== null) {
			try {
				await mergeDoc(remoteBinary);
			} catch (mergeErr) {
				const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
				console.error('Sync merge error:', mergeErr);
				setSyncError(`Merge failed: ${message}`);
				return { success: false, error: `Merge failed: ${message}` };
			}
		}

		// Step 3: Get merged local state and push
		try {
			const localBinary = getDocBinary();
			await pushToRemote(config, localBinary);
		} catch (pushErr) {
			const message = pushErr instanceof Error ? pushErr.message : 'Failed to push';
			setSyncError(`Push failed: ${message}`);
			return { success: false, error: `Push failed: ${message}` };
		}

		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed';
		console.error('Sync error:', err);
		setSyncError(message);
		return { success: false, error: message };
	}
}

/**
 * S3 sync implementation — same pull/merge/push pattern as R2 but
 * uses the S3 client with AWS SigV4 signing.
 */
async function syncS3(): Promise<{ success: boolean; error?: string }> {
	const config = getS3Config();
	if (!config) {
		return { success: false, error: 'S3 sync not configured' };
	}

	const vaultId = get(currentVaultId);
	setSyncing();

	try {
		// Pull
		let remoteBinary: Uint8Array | null;
		try {
			remoteBinary = await s3Pull(config, vaultId);
		} catch (pullErr) {
			const message = pullErr instanceof Error ? pullErr.message : 'Failed to pull';
			setSyncError(`S3 pull failed: ${message}`);
			return { success: false, error: `S3 pull failed: ${message}` };
		}

		// Merge
		if (remoteBinary !== null) {
			try {
				await mergeDoc(remoteBinary);
			} catch (mergeErr) {
				const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
				setSyncError(`S3 merge failed: ${message}`);
				return { success: false, error: `S3 merge failed: ${message}` };
			}
		}

		// Push
		try {
			const localBinary = getDocBinary();
			await s3Push(config, vaultId, localBinary);
		} catch (pushErr) {
			const message = pushErr instanceof Error ? pushErr.message : 'Failed to push';
			setSyncError(`S3 push failed: ${message}`);
			return { success: false, error: `S3 push failed: ${message}` };
		}

		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'S3 sync failed';
		setSyncError(message);
		return { success: false, error: message };
	}
}

/**
 * WebDAV sync implementation
 */
async function syncWebDAV(): Promise<{ success: boolean; error?: string }> {
	const config = getWebDAVConfig();
	if (!config) return { success: false, error: 'WebDAV not configured' };
	const vaultId = get(currentVaultId);
	setSyncing();
	try {
		const remoteBinary = await webdavPull(config, vaultId);
		if (remoteBinary) await mergeDoc(remoteBinary);
		const localBinary = getDocBinary();
		await webdavPush(config, vaultId, localBinary);
		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'WebDAV sync failed';
		setSyncError(msg);
		return { success: false, error: msg };
	}
}

/**
 * Local filesystem sync implementation
 */
async function syncLocalFS(): Promise<{ success: boolean; error?: string }> {
	setSyncing();
	try {
		const remoteBinary = await localFSPull();
		if (remoteBinary) await mergeDoc(remoteBinary);
		const localBinary = getDocBinary();
		await localFSPush(localBinary);
		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Local FS sync failed';
		setSyncError(msg);
		return { success: false, error: msg };
	}
}

/**
 * Azure Blob sync implementation
 */
async function syncAzureBlob(): Promise<{ success: boolean; error?: string }> {
	const config = getAzureBlobConfig();
	if (!config) return { success: false, error: 'Azure Blob not configured' };
	const vaultId = get(currentVaultId);
	setSyncing();
	try {
		const remoteBinary = await azureBlobPull(config, vaultId);
		if (remoteBinary) await mergeDoc(remoteBinary);
		const localBinary = getDocBinary();
		await azureBlobPush(config, vaultId, localBinary);
		setSyncSuccess();
		return { success: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Azure Blob sync failed';
		setSyncError(msg);
		return { success: false, error: msg };
	}
}

/**
 * Push the current doc binary to a specific method. Used by the
 * mirror system to replicate to non-primary targets.
 */
async function pushToMethod(method: SyncMethod, binary: Uint8Array): Promise<void> {
	const vaultId = get(currentVaultId);
	switch (method) {
		case 'r2': {
			const config = getSyncConfig();
			if (config) await pushToRemote(config, binary);
			break;
		}
		case 's3': {
			const config = getS3Config();
			if (config) await s3Push(config, vaultId, binary);
			break;
		}
		case 'webdav': {
			const config = getWebDAVConfig();
			if (config) await webdavPush(config, vaultId, binary);
			break;
		}
		case 'local-fs': {
			await localFSPush(binary);
			break;
		}
		case 'azure-blob': {
			const config = getAzureBlobConfig();
			if (config) await azureBlobPush(config, vaultId, binary);
			break;
		}
		// Git mirrors are not supported — git sync has its own round-trip
		// format (markdown files) that can't be driven by a binary push.
		case 'git':
		default:
			break;
	}
}

/**
 * After a successful primary sync, push the merged state to all
 * configured mirrors. Mirrors are best-effort: individual failures
 * are logged but don't fail the overall sync.
 */
async function pushToMirrors(): Promise<void> {
	const mirrors = getMirrorMethods();
	if (mirrors.length === 0) return;

	const primary = getSyncMethod();
	const binary = getDocBinary();

	for (const mirror of mirrors) {
		if (mirror === primary || !mirror) continue;
		try {
			await pushToMethod(mirror, binary);
		} catch (err) {
			console.warn(`Mirror push to ${mirror} failed:`, err);
		}
	}
}

/**
 * Git sync implementation
 */
async function syncGitMethod(): Promise<{ success: boolean; error?: string }> {
	if (!isGitSyncConfigured()) {
		return { success: false, error: 'Git sync not configured' };
	}

	try {
		const currentVault = get(vaults).find((v) => v.id === get(currentVaultId));
		if (!currentVault) {
			return { success: false, error: 'No vault selected' };
		}

		const localMemories = get(memoryObjects).filter((m) => m.vaultId === currentVault.id);
		const localFolders = get(folders).filter((f) => f.vaultId === currentVault.id);
		const localPeople = get(people).filter((p) => p.vaultId === currentVault.id);
		const localEvents = get(events).filter((e) => e.vaultId === currentVault.id);
		const localActionItems = get(actionItems).filter(
			(a) => a.vaultId === currentVault.id
		);

		// Import callback - will be called when remote changes need to be imported
		const onImport = async (
			importedMemories: MemoryObject[],
			importedFolders: Folder[],
			importedPeople: Person[],
			importedEvents: Event[],
			importedActionItems: ActionItem[]
		) => {
			// TODO: Implement proper import into Automerge store
			// For now, this is a placeholder - the actual merge happens in syncGit
			console.log('Importing from git:', {
				memories: importedMemories.length,
				folders: importedFolders.length,
				people: importedPeople.length,
				events: importedEvents.length,
				actionItems: importedActionItems.length
			});
		};

		const lastSyncedAt = get(gitSyncState).lastSyncedAt;
		await syncGit(
			localMemories,
			localFolders,
			currentVault,
			localPeople,
			localEvents,
			localActionItems,
			lastSyncedAt,
			onImport
		);
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Git sync failed';
		// Conflicts aren't really errors — they need user input. The
		// git service already transitioned gitSyncState to 'conflict',
		// so we just report the pause without flagging an error.
		if (message.includes('conflict')) {
			console.log('Git sync paused for conflict resolution');
			return { success: false, error: message };
		}
		console.error('Git sync error:', err);
		return { success: false, error: message };
	}
}

/**
 * Main sync function - delegates to R2 or Git based on config
 */
export async function sync(): Promise<{ success: boolean; error?: string }> {
	const method = getSyncMethod();

	let result: { success: boolean; error?: string };

	switch (method) {
		case 'git':
			result = await syncGitMethod();
			break;
		case 's3':
			result = await syncS3();
			break;
		case 'webdav':
			result = await syncWebDAV();
			break;
		case 'local-fs':
			result = await syncLocalFS();
			break;
		case 'azure-blob':
			result = await syncAzureBlob();
			break;
		case 'r2':
		default:
			result = await syncR2();
			break;
	}

	// After a successful primary sync, push the merged state to all
	// configured mirror methods. This is best-effort — mirror failures
	// don't affect the primary result.
	if (result.success) {
		try {
			await pushToMirrors();
		} catch (err) {
			console.warn('Mirror push encountered errors:', err);
		}
	}

	return result;
}

// Visibility change sync
let visibilityListenerAdded = false;

function shouldSync(): boolean {
	if (!isSyncConfigured()) return false;

	const method = getSyncMethod();

	// Check status based on sync method
	if (method === 'git') {
		const gitState = get(gitSyncState);
		if (['cloning', 'pulling', 'pushing', 'syncing'].includes(gitState.status)) return false;
		if (gitState.lastSyncedAt) {
			const timeSinceLastSync = Date.now() - gitState.lastSyncedAt;
			if (timeSinceLastSync < MIN_SYNC_INTERVAL_MS) return false;
		}
	} else {
		const state = get(syncState);
		if (state.status === 'syncing') return false;
		if (state.lastSyncedAt) {
			const timeSinceLastSync = Date.now() - state.lastSyncedAt;
			if (timeSinceLastSync < MIN_SYNC_INTERVAL_MS) return false;
		}
	}

	return true;
}

function handleVisibilityChange(): void {
	if (document.visibilityState === 'visible' && shouldSync()) {
		sync().catch(console.error);
	}
}

export function setupVisibilitySync(): void {
	if (typeof document === 'undefined') return;
	if (visibilityListenerAdded) return;

	document.addEventListener('visibilitychange', handleVisibilityChange);
	visibilityListenerAdded = true;
}

export function teardownVisibilitySync(): void {
	if (typeof document === 'undefined') return;
	if (!visibilityListenerAdded) return;

	document.removeEventListener('visibilitychange', handleVisibilityChange);
	visibilityListenerAdded = false;
}
