import { addNote, addFolder, getFolder, type Note, type Folder } from '$lib/db';

export interface ObsidianImportResult {
	success: boolean;
	foldersCreated: number;
	notesCreated: number;
	skipped: string[];
	error?: string;
}

interface FileEntry {
	name: string;
	path: string;
	content: string;
}

interface FolderEntry {
	name: string;
	path: string;
}

/**
 * Import an Obsidian vault from a directory.
 * Uses the File System Access API to read the vault folder.
 */
export async function importObsidianVault(): Promise<ObsidianImportResult> {
	// Check if File System Access API is supported
	if (!('showDirectoryPicker' in window)) {
		return {
			success: false,
			foldersCreated: 0,
			notesCreated: 0,
			skipped: [],
			error: 'Your browser does not support folder selection. Please use Chrome, Edge, or another Chromium-based browser.'
		};
	}

	try {
		// Prompt user to select the Obsidian vault folder
		const dirHandle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();

		const files: FileEntry[] = [];
		const folders: FolderEntry[] = [];
		const skipped: string[] = [];

		// Recursively read all files and folders
		await readDirectory(dirHandle, '', files, folders, skipped);

		// Create folder structure first
		const folderIdMap = new Map<string, string>(); // path -> folder ID
		let foldersCreated = 0;

		// Sort folders by depth (shallow first) to ensure parents exist before children
		folders.sort((a, b) => {
			const depthA = a.path.split('/').length;
			const depthB = b.path.split('/').length;
			return depthA - depthB;
		});

		for (const folder of folders) {
			const parentPath = getParentPath(folder.path);
			const parentId = parentPath ? folderIdMap.get(parentPath) || null : null;

			const newFolder = addFolder(folder.name, parentId);
			folderIdMap.set(folder.path, newFolder.id);
			foldersCreated++;
		}

		// Create notes
		let notesCreated = 0;
		for (const file of files) {
			const parentPath = getParentPath(file.path);
			const folderId = parentPath ? folderIdMap.get(parentPath) || null : null;

			// Remove .md extension for title
			const title = file.name.replace(/\.md$/i, '');

			addNote(title, file.content, folderId);
			notesCreated++;
		}

		return {
			success: true,
			foldersCreated,
			notesCreated,
			skipped
		};
	} catch (error) {
		// User cancelled the picker
		if (error instanceof Error && error.name === 'AbortError') {
			return {
				success: false,
				foldersCreated: 0,
				notesCreated: 0,
				skipped: [],
				error: 'Import cancelled'
			};
		}

		return {
			success: false,
			foldersCreated: 0,
			notesCreated: 0,
			skipped: [],
			error: error instanceof Error ? error.message : 'Unknown error occurred'
		};
	}
}

/**
 * Recursively read a directory and collect all markdown files and folders.
 */
async function readDirectory(
	dirHandle: FileSystemDirectoryHandle,
	currentPath: string,
	files: FileEntry[],
	folders: FolderEntry[],
	skipped: string[]
): Promise<void> {
	for await (const entry of dirHandle.values()) {
		const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

		if (entry.kind === 'directory') {
			// Skip hidden folders and Obsidian config
			if (entry.name.startsWith('.')) {
				skipped.push(`${entryPath}/ (hidden folder)`);
				continue;
			}

			// Add folder to list
			folders.push({
				name: entry.name,
				path: entryPath
			});

			// Recursively read subdirectory
			const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
			await readDirectory(subDirHandle, entryPath, files, folders, skipped);
		} else if (entry.kind === 'file') {
			// Only import markdown files
			if (!entry.name.toLowerCase().endsWith('.md')) {
				skipped.push(`${entryPath} (not markdown)`);
				continue;
			}

			// Skip hidden files
			if (entry.name.startsWith('.')) {
				skipped.push(`${entryPath} (hidden file)`);
				continue;
			}

			try {
				const fileHandle = await dirHandle.getFileHandle(entry.name);
				const file = await fileHandle.getFile();
				const content = await file.text();

				files.push({
					name: entry.name,
					path: entryPath,
					content
				});
			} catch (error) {
				skipped.push(`${entryPath} (read error)`);
			}
		}
	}
}

/**
 * Get the parent path from a path string.
 * e.g., "a/b/c" -> "a/b", "a" -> ""
 */
function getParentPath(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash === -1 ? '' : path.substring(0, lastSlash);
}
