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
	type GitSyncConfig
} from './status';
import type { Note, Folder, Vault, Person, Event } from '../db/types';

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
		const result = await git.pull({
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
		});

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
 * Write notes to the repo filesystem
 */
export async function writeNotesToRepo(
	notes: Note[],
	folders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[]
): Promise<void> {
	const pfs = getFsPromises();

	// Generate markdown files
	const markdownFiles = notesToMarkdownFiles(notes, folders);

	// Generate metadata
	const metadata = createMetadata(vault, folders, notes, people, events);
	const metadataJson = serializeMetadata(metadata);

	// Write metadata file
	await ensureDir(`${REPO_DIR}/.kurumi`);
	await pfs.writeFile(`${REPO_DIR}/${METADATA_PATH}`, metadataJson, { encoding: 'utf8' });

	// Write markdown files
	for (const file of markdownFiles) {
		const fullPath = `${REPO_DIR}/${file.path}`;
		const dirPath = fullPath.split('/').slice(0, -1).join('/');
		await ensureDir(dirPath);
		await pfs.writeFile(fullPath, file.content, { encoding: 'utf8' });
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
 * Parse notes from repo files
 */
export function parseNotesFromFiles(
	files: Map<string, string>,
	metadata: GitMetadata | null,
	vaultId: string
): { notes: Note[]; folders: Folder[] } {
	const markdownPaths = Array.from(files.keys()).filter(
		(p) => p.endsWith('.md') && !p.startsWith('.kurumi/')
	);

	// Reconstruct folders
	const { folders, pathToFolderId } = reconstructFolders(markdownPaths, metadata);

	// Set vault ID on folders
	for (const folder of folders) {
		folder.vaultId = vaultId;
	}

	// Parse notes
	const notes: Note[] = [];

	for (const path of markdownPaths) {
		const content = files.get(path)!;
		const parsed = parseMarkdownFile(path, content);

		// Determine folder ID from path
		const pathParts = path.split('/');
		pathParts.pop(); // Remove filename
		const folderPath = pathParts.join('/');
		const folderId = folderPath ? (pathToFolderId[folderPath] || null) : null;

		// Use ID from metadata if available
		const noteId = metadata?.noteIds[path] || parsed.id;

		notes.push({
			id: noteId,
			title: parsed.title,
			content: parsed.content,
			tags: parsed.tags,
			folderId,
			vaultId,
			created: parsed.created,
			modified: parsed.modified
		});
	}

	return { notes, folders };
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
 * Full sync cycle: pull, merge, push
 */
export async function syncGit(
	localNotes: Note[],
	localFolders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[],
	onImport: (notes: Note[], folders: Folder[], people: Person[], events: Event[]) => Promise<void>
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

		// Parse notes from repo
		const { notes: remoteNotes, folders: remoteFolders } = parseNotesFromFiles(
			files,
			metadata,
			vault.id
		);

		// Get people and events from metadata
		const remotePeople = metadata ? Object.values(metadata.people) : [];
		const remoteEvents = metadata ? Object.values(metadata.events) : [];

		// Merge: for now, prefer remote (last-write-wins based on modified time)
		// This could be made smarter with proper conflict resolution
		const mergedNotes = mergeNoteLists(localNotes, remoteNotes);
		const mergedFolders = mergeFolderLists(localFolders, remoteFolders);

		// Import merged data
		await onImport(mergedNotes, mergedFolders, remotePeople, remoteEvents);
	}

	// Write local changes to repo
	await writeNotesToRepo(localNotes, localFolders, vault, people, events);

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
 * Merge two lists of notes, preferring newer versions
 */
function mergeNoteLists(local: Note[], remote: Note[]): Note[] {
	const merged = new Map<string, Note>();

	// Add all local notes
	for (const note of local) {
		merged.set(note.id, note);
	}

	// Merge remote notes
	for (const note of remote) {
		const existing = merged.get(note.id);
		if (!existing || note.modified > existing.modified) {
			merged.set(note.id, note);
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
