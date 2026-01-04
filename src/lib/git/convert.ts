/**
 * Conversion utilities between Kurumi notes and markdown files
 * Handles YAML front matter parsing and generation
 */

import type { Note, Folder, Vault, Person, Event } from '../db/types';
import { generateSlug } from '../utils/markdown-export';

// Re-export generateSlug for use elsewhere
export { generateSlug };

export interface GitMetadata {
	version: number;
	vault: {
		id: string;
		name: string;
		icon?: string;
	};
	folders: Record<string, { name: string; parentId: string | null }>;
	noteIds: Record<string, string>; // path -> noteId mapping
	people: Record<string, Person>;
	events: Record<string, Event>;
}

export interface MarkdownFile {
	path: string;
	content: string;
}

export interface ParsedNote {
	id: string;
	title: string;
	content: string;
	tags: string[];
	created: number;
	modified: number;
}

/**
 * Build folder path for a note
 */
export function buildFolderPath(note: Note, folders: Folder[]): string[] {
	const path: string[] = [];
	let currentFolderId = note.folderId;

	while (currentFolderId) {
		const folder = folders.find((f) => f.id === currentFolderId);
		if (!folder) break;
		path.unshift(generateSlug(folder.name));
		currentFolderId = folder.parentId;
	}

	return path;
}

/**
 * Generate YAML front matter for a note
 */
function generateFrontMatter(note: Note): string {
	const lines = ['---'];
	lines.push(`id: ${note.id}`);
	lines.push(`created: ${new Date(note.created).toISOString()}`);
	lines.push(`modified: ${new Date(note.modified).toISOString()}`);
	if (note.tags.length > 0) {
		lines.push(`tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('---');
	lines.push('');
	return lines.join('\n');
}

/**
 * Parse YAML front matter from markdown content
 */
export function parseFrontMatter(content: string): { frontMatter: Record<string, unknown>; body: string } {
	const frontMatterRegex = /^---\n([\s\S]*?)\n---\n/;
	const match = content.match(frontMatterRegex);

	if (!match) {
		return { frontMatter: {}, body: content };
	}

	const frontMatterStr = match[1];
	const body = content.slice(match[0].length);
	const frontMatter: Record<string, unknown> = {};

	// Simple YAML parser for our use case
	for (const line of frontMatterStr.split('\n')) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		let value: unknown = line.slice(colonIndex + 1).trim();

		// Parse arrays like [tag1, tag2]
		if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
			const arrayStr = value.slice(1, -1);
			value = arrayStr
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean);
		}

		frontMatter[key] = value;
	}

	return { frontMatter, body };
}

/**
 * Convert a note to a markdown file
 */
export function noteToMarkdownFile(note: Note, folders: Folder[]): MarkdownFile {
	const folderPath = buildFolderPath(note, folders);
	const slug = generateSlug(note.title || 'untitled');
	const filename = `${slug}.md`;

	const pathParts = [...folderPath, filename];
	const path = pathParts.join('/');

	const frontMatter = generateFrontMatter(note);
	const content = frontMatter + note.content;

	return { path, content };
}

/**
 * Convert all notes to markdown files
 */
export function notesToMarkdownFiles(notes: Note[], folders: Folder[]): MarkdownFile[] {
	return notes.map((note) => noteToMarkdownFile(note, folders));
}

/**
 * Parse a markdown file into a note
 */
export function parseMarkdownFile(path: string, content: string): ParsedNote {
	const { frontMatter, body } = parseFrontMatter(content);

	// Extract title from filename
	const filename = path.split('/').pop() || 'untitled.md';
	const title = filename.replace(/\.md$/, '').replace(/-/g, ' ');

	// Capitalize first letter of each word
	const formattedTitle = title.replace(/\b\w/g, (c) => c.toUpperCase());

	return {
		id: (frontMatter.id as string) || crypto.randomUUID(),
		title: formattedTitle,
		content: body,
		tags: (frontMatter.tags as string[]) || [],
		created: frontMatter.created ? new Date(frontMatter.created as string).getTime() : Date.now(),
		modified: frontMatter.modified ? new Date(frontMatter.modified as string).getTime() : Date.now()
	};
}

/**
 * Create metadata object for git sync
 */
export function createMetadata(
	vault: Vault,
	folders: Folder[],
	notes: Note[],
	people: Person[],
	events: Event[]
): GitMetadata {
	const foldersMap: Record<string, { name: string; parentId: string | null }> = {};
	for (const folder of folders) {
		foldersMap[folder.id] = { name: folder.name, parentId: folder.parentId };
	}

	const noteIds: Record<string, string> = {};
	for (const note of notes) {
		const file = noteToMarkdownFile(note, folders);
		noteIds[file.path] = note.id;
	}

	const peopleMap: Record<string, Person> = {};
	for (const person of people) {
		peopleMap[person.id] = person;
	}

	const eventsMap: Record<string, Event> = {};
	for (const event of events) {
		eventsMap[event.id] = event;
	}

	return {
		version: 1,
		vault: {
			id: vault.id,
			name: vault.name,
			icon: vault.icon
		},
		folders: foldersMap,
		noteIds,
		people: peopleMap,
		events: eventsMap
	};
}

/**
 * Serialize metadata to JSON
 */
export function serializeMetadata(metadata: GitMetadata): string {
	return JSON.stringify(metadata, null, 2);
}

/**
 * Parse metadata from JSON
 */
export function parseMetadata(json: string): GitMetadata | null {
	try {
		return JSON.parse(json) as GitMetadata;
	} catch {
		return null;
	}
}

/**
 * Merge two notes, preferring the one with the later modified timestamp
 */
export function mergeNotes(local: ParsedNote, remote: ParsedNote): ParsedNote {
	if (local.modified >= remote.modified) {
		return local;
	}
	return remote;
}

/**
 * Reconstruct folder structure from file paths
 */
export function reconstructFolders(
	paths: string[],
	metadata: GitMetadata | null
): { folders: Folder[]; pathToFolderId: Record<string, string> } {
	const folders: Folder[] = [];
	const pathToFolderId: Record<string, string> = {};
	const now = Date.now();

	// If we have metadata, use the folder info from there
	if (metadata) {
		for (const [id, info] of Object.entries(metadata.folders)) {
			folders.push({
				id,
				name: info.name,
				parentId: info.parentId,
				vaultId: metadata.vault.id,
				created: now,
				modified: now
			});
		}
		return { folders, pathToFolderId };
	}

	// Otherwise, reconstruct from paths
	const seenPaths = new Set<string>();

	for (const filePath of paths) {
		const parts = filePath.split('/');
		// Remove the filename
		parts.pop();

		let currentPath = '';
		let parentId: string | null = null;

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			if (!seenPaths.has(currentPath)) {
				seenPaths.add(currentPath);
				const folderId = crypto.randomUUID();
				pathToFolderId[currentPath] = folderId;

				folders.push({
					id: folderId,
					name: part.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
					parentId,
					vaultId: '', // Will be set by caller
					created: now,
					modified: now
				});

				parentId = folderId;
			} else {
				parentId = pathToFolderId[currentPath];
			}
		}
	}

	return { folders, pathToFolderId };
}
