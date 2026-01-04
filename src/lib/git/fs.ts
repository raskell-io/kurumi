/**
 * Filesystem wrapper for isomorphic-git using LightningFS
 * Provides an IndexedDB-backed filesystem for git operations in the browser
 */

import LightningFS from '@isomorphic-git/lightning-fs';

// Singleton filesystem instance
let fs: LightningFS | null = null;

const FS_NAME = 'kurumi-git-fs';

/**
 * Get or initialize the filesystem
 */
export function getFs(): LightningFS {
	if (!fs) {
		fs = new LightningFS(FS_NAME);
	}
	return fs;
}

/**
 * Get the fs.promises interface for async operations
 */
export function getFsPromises() {
	return getFs().promises;
}

/**
 * Clear the git filesystem (for resetting sync)
 */
export async function clearGitFs(): Promise<void> {
	const pfs = getFsPromises();

	try {
		// Remove the repo directory if it exists
		const files = await pfs.readdir('/');
		for (const file of files) {
			await removeRecursive(`/${file}`);
		}
	} catch {
		// Directory might not exist, that's fine
	}
}

/**
 * Recursively remove a directory or file
 */
async function removeRecursive(path: string): Promise<void> {
	const pfs = getFsPromises();

	try {
		const stat = await pfs.stat(path);
		if (stat.isDirectory()) {
			const files = await pfs.readdir(path);
			for (const file of files) {
				await removeRecursive(`${path}/${file}`);
			}
			await pfs.rmdir(path);
		} else {
			await pfs.unlink(path);
		}
	} catch {
		// File/directory might not exist
	}
}

/**
 * Ensure a directory exists (creates parent directories as needed)
 */
export async function ensureDir(path: string): Promise<void> {
	const pfs = getFsPromises();
	const parts = path.split('/').filter(Boolean);
	let currentPath = '';

	for (const part of parts) {
		currentPath += `/${part}`;
		try {
			await pfs.mkdir(currentPath);
		} catch (e: unknown) {
			// Directory might already exist, check if it's actually an error
			const error = e as { code?: string };
			if (error.code !== 'EEXIST') {
				try {
					const stat = await pfs.stat(currentPath);
					if (!stat.isDirectory()) {
						throw new Error(`${currentPath} exists but is not a directory`);
					}
				} catch {
					throw e;
				}
			}
		}
	}
}

/**
 * Read all files in a directory recursively
 */
export async function readDirRecursive(path: string): Promise<string[]> {
	const pfs = getFsPromises();
	const results: string[] = [];

	async function walk(currentPath: string) {
		const entries = await pfs.readdir(currentPath);
		for (const entry of entries) {
			const fullPath = `${currentPath}/${entry}`;
			const stat = await pfs.stat(fullPath);
			if (stat.isDirectory()) {
				await walk(fullPath);
			} else {
				results.push(fullPath);
			}
		}
	}

	try {
		await walk(path);
	} catch {
		// Directory might not exist
	}

	return results;
}

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
	const pfs = getFsPromises();
	try {
		await pfs.stat(path);
		return true;
	} catch {
		return false;
	}
}
