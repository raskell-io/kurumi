import { addMemoryObject, addFolder, addCanvas, updateMemoryObject, batchUpdates } from '$lib/db';
import { parseCanvas, serializeCanvas } from '$lib/canvas';

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

		// One store refresh and save for the whole vault (see batchUpdates).
		let notesCreated = 0;
		batchUpdates(() => {
			for (const folder of folders) {
				const parentPath = getParentPath(folder.path);
				const parentId = parentPath ? folderIdMap.get(parentPath) || null : null;

				const newFolder = addFolder(folder.name, parentId);
				folderIdMap.set(folder.path, newFolder.id);
				foldersCreated++;
			}

			// Create memories (canvases after the notes their cards point to)
			const idByPath = new Map<string, string>();
			const idByTitle = new Map<string, string>();
			for (const file of files.filter((f) => !/\.canvas$/i.test(f.name))) {
				const parentPath = getParentPath(file.path);
				const folderId = parentPath ? folderIdMap.get(parentPath) || null : null;

				// Remove .md extension for title
				const title = file.name.replace(/\.md$/i, '');

				const memory = addMemoryObject(title, file.content, folderId);
				idByPath.set(file.path.toLowerCase(), memory.id);
				idByTitle.set(title.toLowerCase(), memory.id);
				notesCreated++;
			}
			// Obsidian canvases (JSON Canvas): note cards get the imported note's id.
			for (const file of files.filter((f) => /\.canvas$/i.test(f.name))) {
				const parentPath = getParentPath(file.path);
				const folderId = parentPath ? folderIdMap.get(parentPath) || null : null;
				const data = parseCanvas(file.content);
				for (const node of data.nodes) {
					if (node.type !== 'file' || !node.file) continue;
					const path = node.file.toLowerCase();
					const title = node.file.split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
					const id = idByPath.get(path) ?? idByTitle.get(title);
					if (id) node.memoryId = id;
				}
				const canvas = addCanvas(file.name.replace(/\.canvas$/i, ''), folderId);
				updateMemoryObject(canvas.id, { bodyMarkdown: serializeCanvas(data) });
				notesCreated++;
			}
		});

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
	// FileSystemDirectoryHandle.values() exists in browsers but isn't in
	// the standard DOM types yet. Cast to access the async iterator.
	const handle = dirHandle as FileSystemDirectoryHandle & {
		values(): AsyncIterableIterator<FileSystemHandle>;
	};
	for await (const entry of handle.values()) {
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
			// Only import markdown files and canvases
			if (!/\.(md|canvas)$/i.test(entry.name)) {
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
