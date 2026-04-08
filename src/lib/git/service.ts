/**
 * Git sync service using isomorphic-git
 * Handles clone, pull, push, and merge operations
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { getFs, getFsPromises, clearGitFs, ensureDir, readDirRecursive, pathExists } from './fs';
import { CORS_PROXY, getCloneUrl, type GitProviderId } from './providers';
import {
	notesToMarkdownFiles,
	parseMarkdownFile,
	createMetadata,
	serializeMetadata,
	parseMetadata,
	reconstructFolders,
	type GitMetadata,
	type ParsedNote
} from './convert';
import {
	getGitSyncConfig,
	setGitCloning,
	setGitPulling,
	setGitPushing,
	setGitSyncSuccess,
	setGitSyncError,
	setGitProgress,
	setGitConflicts,
	type GitSyncConfig,
	type MemoryConflict
} from './status';
import type { MemoryObject, Folder, Vault, Person, Event, ActionItem } from '../db/types';

const REPO_DIR = '/repo';
const METADATA_PATH = '.kurumi/metadata.json';

/**
 * Progress callback for git operations
 */
function onProgress(event: { phase: string; loaded: number; total: number }) {
	setGitProgress(event.phase, event.loaded, event.total);
}

/**
 * Get auth config for git operations
 */
function getAuth(config: GitSyncConfig) {
	return {
		username: config.token,
		password: 'x-oauth-basic' // GitHub/GitLab/Codeberg all accept token as username
	};
}

/**
 * Check if repo is already cloned
 */
export async function isRepoCloned(): Promise<boolean> {
	return await pathExists(`${REPO_DIR}/.git`);
}

/**
 * Clone a repository
 */
export async function cloneRepo(config: GitSyncConfig): Promise<void> {
	setGitCloning();

	try {
		// Clear any existing repo
		await clearGitFs();
		await ensureDir(REPO_DIR);

		const url = getCloneUrl(config.repoUrl);

		await git.clone({
			fs: getFs(),
			http,
			dir: REPO_DIR,
			url,
			ref: config.branch,
			singleBranch: true,
			depth: 1,
			corsProxy: CORS_PROXY,
			onProgress,
			onAuth: () => getAuth(config)
		});

		const head = await git.resolveRef({ fs: getFs(), dir: REPO_DIR, ref: 'HEAD' });
		setGitSyncSuccess(head);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Clone failed';
		setGitSyncError(message);
		throw error;
	}
}

/**
 * Pull changes from remote
 */
export async function pullChanges(config: GitSyncConfig): Promise<boolean> {
	setGitPulling();

	try {
		// isomorphic-git's type definition says git.pull returns void, but at
		// runtime it returns an object with `alreadyUpToDate`. Cast to a
		// minimal shape so we can read it without `as any`.
		const result = (await git.pull({
			fs: getFs(),
			http,
			dir: REPO_DIR,
			ref: config.branch,
			singleBranch: true,
			corsProxy: CORS_PROXY,
			onProgress,
			onAuth: () => getAuth(config),
			author: {
				name: config.authorName,
				email: config.authorEmail
			}
		})) as unknown as { alreadyUpToDate?: boolean };

		return result.alreadyUpToDate !== true;
	} catch (error) {
		// If pull fails due to merge conflict, we'll handle it
		const message = error instanceof Error ? error.message : 'Pull failed';
		if (!message.includes('merge')) {
			setGitSyncError(message);
			throw error;
		}
		return true; // There are changes to merge
	}
}

/**
 * Push changes to remote
 */
export async function pushChanges(config: GitSyncConfig): Promise<void> {
	setGitPushing();

	try {
		await git.push({
			fs: getFs(),
			http,
			dir: REPO_DIR,
			remote: 'origin',
			ref: config.branch,
			corsProxy: CORS_PROXY,
			onProgress,
			onAuth: () => getAuth(config)
		});

		const head = await git.resolveRef({ fs: getFs(), dir: REPO_DIR, ref: 'HEAD' });
		setGitSyncSuccess(head);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Push failed';
		setGitSyncError(message);
		throw error;
	}
}

/**
 * Read all markdown files from the repo
 */
export async function readRepoFiles(): Promise<Map<string, string>> {
	const pfs = getFsPromises();
	const files = new Map<string, string>();

	const allPaths = await readDirRecursive(REPO_DIR);

	for (const fullPath of allPaths) {
		// Get relative path
		const relativePath = fullPath.slice(REPO_DIR.length + 1);

		// Skip .git directory and non-markdown files
		if (relativePath.startsWith('.git/')) continue;
		if (!relativePath.endsWith('.md') && relativePath !== METADATA_PATH) continue;

		const content = await pfs.readFile(fullPath, { encoding: 'utf8' });
		files.set(relativePath, content as string);
	}

	return files;
}

/**
 * Read metadata from repo
 */
export async function readRepoMetadata(): Promise<GitMetadata | null> {
	const pfs = getFsPromises();
	const metadataPath = `${REPO_DIR}/${METADATA_PATH}`;

	try {
		const content = await pfs.readFile(metadataPath, { encoding: 'utf8' });
		return parseMetadata(content as string);
	} catch {
		return null;
	}
}

/**
 * Write memories to the repo filesystem
 */
export async function writeNotesToRepo(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[],
	actionItems: ActionItem[] = []
): Promise<void> {
	const pfs = getFsPromises();

	// Generate markdown files
	const markdownFiles = notesToMarkdownFiles(memories, folders);

	// Generate metadata
	const metadata = createMetadata(vault, folders, memories, people, events, actionItems);
	const metadataJson = serializeMetadata(metadata);

	// Write metadata file
	await ensureDir(`${REPO_DIR}/.kurumi`);
	await pfs.writeFile(`${REPO_DIR}/${METADATA_PATH}`, metadataJson, 'utf8');

	// Write markdown files
	for (const file of markdownFiles) {
		const fullPath = `${REPO_DIR}/${file.path}`;
		const dirPath = fullPath.split('/').slice(0, -1).join('/');
		await ensureDir(dirPath);
		await pfs.writeFile(fullPath, file.content, 'utf8');
	}
}

/**
 * Stage all changes
 */
export async function stageAllChanges(): Promise<void> {
	const fs = getFs();

	// Get list of all files
	const allPaths = await readDirRecursive(REPO_DIR);

	for (const fullPath of allPaths) {
		const relativePath = fullPath.slice(REPO_DIR.length + 1);
		if (relativePath.startsWith('.git/')) continue;

		await git.add({
			fs,
			dir: REPO_DIR,
			filepath: relativePath
		});
	}

	// Also stage deletions
	const status = await git.statusMatrix({ fs, dir: REPO_DIR });
	for (const [filepath, head, workdir, stage] of status) {
		if (workdir === 0 && stage === 1) {
			// File was deleted
			await git.remove({ fs, dir: REPO_DIR, filepath });
		}
	}
}

/**
 * Commit changes
 */
export async function commitChanges(config: GitSyncConfig, message: string): Promise<string> {
	const sha = await git.commit({
		fs: getFs(),
		dir: REPO_DIR,
		message,
		author: {
			name: config.authorName,
			email: config.authorEmail
		}
	});

	return sha;
}

/**
 * Check if there are local changes to commit
 */
export async function hasLocalChanges(): Promise<boolean> {
	const status = await git.statusMatrix({ fs: getFs(), dir: REPO_DIR });

	for (const [, head, workdir, stage] of status) {
		// Check if any file has changes
		if (head !== workdir || head !== stage) {
			return true;
		}
	}

	return false;
}

/**
 * Parse memories from repo files
 */
export function parseNotesFromFiles(
	files: Map<string, string>,
	metadata: GitMetadata | null,
	vaultId: string
): { memories: MemoryObject[]; folders: Folder[] } {
	const markdownPaths = Array.from(files.keys()).filter(
		(p) => p.endsWith('.md') && !p.startsWith('.kurumi/')
	);

	// Reconstruct folders
	const { folders, pathToFolderId } = reconstructFolders(markdownPaths, metadata);

	// Set vault ID on folders
	for (const folder of folders) {
		folder.vaultId = vaultId;
	}

	// Parse memories
	const memories: MemoryObject[] = [];

	for (const path of markdownPaths) {
		const content = files.get(path)!;
		const parsed = parseMarkdownFile(path, content);

		// Determine folder ID from path
		const pathParts = path.split('/');
		pathParts.pop(); // Remove filename
		const folderPath = pathParts.join('/');
		const folderId = folderPath ? pathToFolderId[folderPath] || null : null;

		// Use ID from metadata if available
		const memoryId = metadata?.noteIds[path] || parsed.id;

		memories.push({
			id: memoryId,
			type: 'note',
			space: 'personal',
			parentBucket: null,
			folderId,
			title: parsed.title,
			rawText: '',
			bodyMarkdown: parsed.content,
			rawAudioRef: null,
			rawMediaRef: null,
			transcript: null,
			transcriptSegments: [],
			summaryShort: null,
			summaryLong: null,
			createdAt: parsed.created,
			updatedAt: parsed.modified,
			capturedAt: parsed.created,
			sourceDevice: null,
			sourceContext: null,
			language: null,
			tags: parsed.tags,
			controlledLabels: [],
			participants: [],
			entities: [],
			projects: [],
			topics: [],
			dates: [],
			actionItems: [],
			decisions: [],
			relatedMemoryIds: [],
			visibilityScope: 'personal',
			processingState: 'ready',
			processingError: null,
			confidenceScores: {},
			embeddingRef: null,
			meetingExtras: null,
			vaultId,
			deletedAt: null
		});
	}

	return { memories, folders };
}

/**
 * Test git connection
 */
export async function testGitConnection(
	provider: GitProviderId,
	repoUrl: string,
	token: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const url = getCloneUrl(repoUrl);

		// Try to get remote info
		await git.getRemoteInfo({
			http,
			url,
			corsProxy: CORS_PROXY,
			onAuth: () => ({
				username: token,
				password: 'x-oauth-basic'
			})
		});

		return { success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Connection failed';
		return { success: false, error: message };
	}
}

/**
 * Detect memories whose local and remote versions have both changed
 * since the last successful sync. Uses this device's lastSyncedAt as a
 * proxy for the last known common ancestor:
 *
 * - If both sides updated AFTER lastSyncedAt and the bodies actually
 *   differ, it's a conflict.
 * - If only one side updated, last-write-wins is fine.
 * - If bodies are byte-identical, no conflict regardless of timestamps.
 */
function detectConflicts(
	local: MemoryObject[],
	remote: MemoryObject[],
	lastSyncedAt: number | null
): MemoryConflict[] {
	if (!lastSyncedAt) return []; // First sync: nothing to conflict against
	const remoteById = new Map(remote.map((m) => [m.id, m]));
	const conflicts: MemoryConflict[] = [];
	for (const l of local) {
		const r = remoteById.get(l.id);
		if (!r) continue;
		if (l.updatedAt <= lastSyncedAt) continue; // Local unchanged since sync
		if (r.updatedAt <= lastSyncedAt) continue; // Remote unchanged since sync
		if (l.bodyMarkdown === r.bodyMarkdown && l.title === r.title) continue;
		conflicts.push({
			memoryId: l.id,
			title: l.title || 'Untitled',
			localUpdatedAt: l.updatedAt,
			remoteUpdatedAt: r.updatedAt,
			localBody: l.bodyMarkdown,
			remoteBody: r.bodyMarkdown
		});
	}
	return conflicts;
}

/**
 * Full sync cycle: pull, merge, push
 */
export async function syncGit(
	localMemories: MemoryObject[],
	localFolders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[],
	localActionItems: ActionItem[],
	lastSyncedAt: number | null,
	onImport: (
		memories: MemoryObject[],
		folders: Folder[],
		people: Person[],
		events: Event[],
		actionItems: ActionItem[]
	) => Promise<void>
): Promise<void> {
	const config = getGitSyncConfig();
	if (!config) {
		throw new Error('Git sync not configured');
	}

	// Clone if needed
	if (!(await isRepoCloned())) {
		await cloneRepo(config);
	}

	// Pull remote changes
	const hasRemoteChanges = await pullChanges(config);

	if (hasRemoteChanges) {
		// Read files from repo
		const files = await readRepoFiles();
		const metadata = await readRepoMetadata();

		// Parse memories from repo
		const { memories: remoteMemories, folders: remoteFolders } = parseNotesFromFiles(
			files,
			metadata,
			vault.id
		);

		// Get people, events, and action items from metadata
		const remotePeople = metadata ? Object.values(metadata.people) : [];
		const remoteEvents = metadata ? Object.values(metadata.events) : [];
		const remoteActionItems = metadata?.actionItems
			? Object.values(metadata.actionItems)
			: [];

		// Detect real conflicts before merging: anything touched on both
		// sides since the last sync is surfaced to the user instead of
		// silently losing data.
		const conflicts = detectConflicts(localMemories, remoteMemories, lastSyncedAt);
		if (conflicts.length > 0) {
			setGitConflicts(conflicts);
			// Stop the sync here. The user resolves via the settings UI,
			// which then calls resolveConflict() + syncGit() again.
			throw new Error(`${conflicts.length} conflict(s) need resolution`);
		}

		// Merge non-conflicting changes: prefer newer by updatedAt
		const mergedMemories = mergeMemoryLists(localMemories, remoteMemories);
		const mergedFolders = mergeFolderLists(localFolders, remoteFolders);
		const mergedActionItems = mergeActionItemLists(localActionItems, remoteActionItems);

		// Import merged data
		await onImport(
			mergedMemories,
			mergedFolders,
			remotePeople,
			remoteEvents,
			mergedActionItems
		);
	}

	// Write local changes to repo
	await writeNotesToRepo(
		localMemories,
		localFolders,
		vault,
		people,
		events,
		localActionItems
	);

	// Check for changes
	if (await hasLocalChanges()) {
		await stageAllChanges();
		await commitChanges(config, `Sync from Kurumi - ${new Date().toISOString()}`);
		await pushChanges(config);
	} else {
		setGitSyncSuccess();
	}
}

/**
 * Merge two lists of memories, preferring newer versions
 */
function mergeMemoryLists(local: MemoryObject[], remote: MemoryObject[]): MemoryObject[] {
	const merged = new Map<string, MemoryObject>();

	// Add all local memories
	for (const memory of local) {
		merged.set(memory.id, memory);
	}

	// Merge remote memories
	for (const memory of remote) {
		const existing = merged.get(memory.id);
		if (!existing || memory.updatedAt > existing.updatedAt) {
			merged.set(memory.id, memory);
		}
	}

	return Array.from(merged.values());
}

/**
 * Merge two lists of folders
 */
function mergeFolderLists(local: Folder[], remote: Folder[]): Folder[] {
	const merged = new Map<string, Folder>();

	// Add all local folders
	for (const folder of local) {
		merged.set(folder.id, folder);
	}

	// Merge remote folders
	for (const folder of remote) {
		const existing = merged.get(folder.id);
		if (!existing || folder.modified > existing.modified) {
			merged.set(folder.id, folder);
		}
	}

	return Array.from(merged.values());
}

/**
 * Apply a user-selected resolution for a single memory conflict by
 * writing the chosen body back into the memory and bumping updatedAt
 * past the current instant so the next sync treats it as the winner.
 *
 * Takes the raw memory list and returns a new list (doesn't mutate the
 * store; the caller is responsible for persisting via onImport).
 */
export function applyConflictResolution(
	memories: MemoryObject[],
	conflict: MemoryConflict,
	choice: 'local' | 'remote'
): MemoryObject[] {
	const chosenBody = choice === 'local' ? conflict.localBody : conflict.remoteBody;
	const now = Date.now();
	return memories.map((m) => {
		if (m.id !== conflict.memoryId) return m;
		return { ...m, bodyMarkdown: chosenBody, updatedAt: now };
	});
}

/**
 * Merge two lists of action items, preferring newer versions
 */
function mergeActionItemLists(local: ActionItem[], remote: ActionItem[]): ActionItem[] {
	const merged = new Map<string, ActionItem>();

	for (const item of local) {
		merged.set(item.id, item);
	}

	for (const item of remote) {
		const existing = merged.get(item.id);
		if (!existing || item.updatedAt > existing.updatedAt) {
			merged.set(item.id, item);
		}
	}

	return Array.from(merged.values());
}
