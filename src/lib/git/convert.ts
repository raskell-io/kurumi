/**
 * Conversion utilities between Kurumi memory objects and markdown files
 * Handles YAML front matter parsing and generation.
 *
 * The on-disk format keeps the legacy `created` / `modified` / `content`
 * front-matter keys so existing git repos remain readable; we map to/from
 * MemoryObject's `createdAt` / `updatedAt` / `bodyMarkdown` internally.
 */

import type { MemoryObject, Folder, Vault, Person, Event, ActionItem } from '../db/types';
import { generateSlug } from '../utils/markdown-export';

// Re-export generateSlug for use elsewhere
export { generateSlug };

export interface GitMetadata {
	version: number;
	vault: {
		id: string;
		name: string;
		icon?: string;
		iconImage?: string;
	};
	folders: Record<string, { name: string; parentId: string | null }>;
	noteIds: Record<string, string>; // path -> memoryId mapping
	// Per-note fields markdown doesn't carry, keyed by memory id. Only notes
	// with something to record are listed; the key's presence means the
	// writer knew about these fields (see GitImportData.noteExtrasKnown).
	notes?: Record<string, NoteExtras>;
	// Projects, decisions, questions, meeting series, proposals and templates.
	work?: {
		projects: unknown[];
		decisions: unknown[];
		questions: unknown[];
		meetingSeries: unknown[];
		reminderProposals?: unknown[];
		draftProposals?: unknown[];
		templates?: unknown[];
	};
	people: Record<string, Person>;
	events: Record<string, Event>;
	actionItems?: Record<string, ActionItem>;
	// Mime type for each blob ref written under .kurumi/blobs/, so importers
	// can reconstruct the Blob with the right type. Keyed by `blob:<id>` ref.
	blobs?: Record<string, { mimeType: string }>;
}

export interface NoteExtras {
	icon?: string; // uploaded image icons only; emoji live in frontmatter
	favoritedAt?: number;
	favoriteChangedAt?: number;
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
	icon?: string;
	created: number;
	modified: number;
}

/**
 * Build folder path for a memory
 */
export function buildFolderPath(memory: MemoryObject, folders: Folder[]): string[] {
	const path: string[] = [];
	let currentFolderId = memory.folderId;

	while (currentFolderId) {
		const folder = folders.find((f) => f.id === currentFolderId);
		if (!folder) break;
		path.unshift(generateSlug(folder.name));
		currentFolderId = folder.parentId;
	}

	return path;
}

/**
 * Generate YAML front matter for a memory
 */
function generateFrontMatter(memory: MemoryObject): string {
	const lines = ['---'];
	lines.push(`id: ${memory.id}`);
	// Persist the exact title. The filename is a slug (spaces → hyphens, case
	// folded), so without this the original title can't be recovered on import.
	if (memory.title) {
		const escaped = memory.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		lines.push(`name: "${escaped}"`);
	}
	lines.push(`created: ${new Date(memory.createdAt).toISOString()}`);
	lines.push(`modified: ${new Date(memory.updatedAt).toISOString()}`);
	if (memory.tags.length > 0) {
		lines.push(`tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	// Emoji icons only; uploaded-image icons stay in the database.
	if (memory.icon && !memory.icon.startsWith('data:')) {
		lines.push(`icon: "${memory.icon.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
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
		} else if (typeof value === 'string') {
			// Strip surrounding quotes from scalar strings and unescape, so
			// `name: "My Note: \"Q3\""` round-trips back to the real title.
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value
					.slice(1, -1)
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, '\\');
			}
		}

		frontMatter[key] = value;
	}

	return { frontMatter, body };
}

/**
 * Convert a memory to a markdown file
 */
export function noteToMarkdownFile(
	memory: MemoryObject,
	folders: Folder[],
	path: string = [...buildFolderPath(memory, folders), `${generateSlug(memory.title || 'untitled')}.md`].join('/')
): MarkdownFile {
	const frontMatter = generateFrontMatter(memory);
	const content = frontMatter + memory.bodyMarkdown;

	return { path, content };
}

/**
 * Convert all memories to markdown files
 */
export function notesToMarkdownFiles(memories: MemoryObject[], folders: Folder[]): MarkdownFile[] {
	const paths = noteFilePaths(memories, folders);
	return memories.map((memory) => noteToMarkdownFile(memory, folders, paths.get(memory.id)));
}

/**
 * The file each note is written to, one per note: of notes that would share a
 * path (same title and folder), the oldest keeps it and the others get their
 * id added, so none overwrites another's file. Compared case-insensitively,
 * as many disks are.
 */
export function noteFilePaths(memories: MemoryObject[], folders: Folder[]): Map<string, string> {
	const paths = new Map<string, string>();
	const taken = new Set<string>();
	const oldestFirst = [...memories].sort(
		(a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
	for (const memory of oldestFirst) {
		const plain = noteToMarkdownFile(memory, folders).path;
		const stem = plain.slice(0, -'.md'.length);
		let path = plain;
		if (taken.has(path.toLowerCase())) path = `${stem}-${memory.id.slice(0, 8)}.md`;
		if (taken.has(path.toLowerCase())) path = `${stem}-${memory.id}.md`;
		taken.add(path.toLowerCase());
		paths.set(memory.id, path);
	}
	return paths;
}

/**
 * Parse a markdown file into a note
 */
export function parseMarkdownFile(path: string, content: string): ParsedNote {
	const { frontMatter, body } = parseFrontMatter(content);

	// Prefer the exact title from front matter (preserves spaces, case, and
	// punctuation). Fall back to de-slugging the filename for notes written
	// before `name:` existed or created by hand.
	const filename = path.split('/').pop() || 'untitled.md';
	const deslugged = filename
		.replace(/\.md$/, '')
		.replace(/-/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
	const frontMatterName =
		typeof frontMatter.name === 'string' ? frontMatter.name.trim() : '';
	const title = frontMatterName || deslugged;

	return {
		id: (frontMatter.id as string) || crypto.randomUUID(),
		title,
		content: body,
		tags: (frontMatter.tags as string[]) || [],
		...(typeof frontMatter.icon === 'string' && frontMatter.icon ? { icon: frontMatter.icon } : {}),
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
	memories: MemoryObject[],
	people: Person[],
	events: Event[],
	actionItems: ActionItem[] = [],
	blobs: Record<string, { mimeType: string }> = {},
	work?: GitMetadata['work']
): GitMetadata {
	const foldersMap: Record<string, { name: string; parentId: string | null }> = {};
	for (const folder of folders) {
		foldersMap[folder.id] = { name: folder.name, parentId: folder.parentId };
	}

	const noteIds: Record<string, string> = {};
	const notes: Record<string, NoteExtras> = {};
	const paths = noteFilePaths(memories, folders);
	for (const memory of memories) {
		noteIds[paths.get(memory.id)!] = memory.id;
		const extras: NoteExtras = {
			...(memory.icon?.startsWith('data:') ? { icon: memory.icon } : {}),
			...(memory.favoritedAt ? { favoritedAt: memory.favoritedAt } : {}),
			...(memory.favoriteChangedAt ? { favoriteChangedAt: memory.favoriteChangedAt } : {})
		};
		if (Object.keys(extras).length > 0) notes[memory.id] = extras;
	}

	const peopleMap: Record<string, Person> = {};
	for (const person of people) {
		peopleMap[person.id] = person;
	}

	const eventsMap: Record<string, Event> = {};
	for (const event of events) {
		eventsMap[event.id] = event;
	}

	const actionItemsMap: Record<string, ActionItem> = {};
	for (const item of actionItems) {
		actionItemsMap[item.id] = item;
	}

	return {
		version: 2,
		vault: {
			id: vault.id,
			name: vault.name,
			icon: vault.icon,
			iconImage: vault.iconImage
		},
		folders: foldersMap,
		noteIds,
		notes,
		...(work ? { work } : {}),
		people: peopleMap,
		events: eventsMap,
		actionItems: actionItemsMap,
		blobs
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
 * Reconstruct folder structure from file paths. Directories are matched to
 * the folders in the metadata by the slug path Kurumi writes them under; a
 * directory the metadata doesn't list (added by hand) becomes a new folder.
 */
export function reconstructFolders(
	paths: string[],
	metadata: GitMetadata | null
): { folders: Folder[]; pathToFolderId: Record<string, string> } {
	const folders: Folder[] = [];
	const pathToFolderId: Record<string, string> = {};
	const now = Date.now();
	const slugOf = (name: string) => generateSlug(name) || name;

	// Slug path ("client-x/notes") → folder id, for the folders we know.
	const idBySlugPath = new Map<string, string>();
	if (metadata) {
		const known = metadata.folders ?? {};
		for (const [id, info] of Object.entries(known)) {
			folders.push({
				id,
				name: info.name,
				parentId: info.parentId,
				vaultId: metadata.vault.id,
				created: now,
				modified: now,
				deletedAt: null
			});
			const parts: string[] = [];
			const seen = new Set<string>(); // the file can be edited by hand
			for (let at: string | null = id; at && known[at] && !seen.has(at); at = known[at].parentId) {
				seen.add(at);
				parts.unshift(generateSlug(known[at].name));
			}
			// A name with no slug (e.g. Japanese) gets no directory of its own
			// (see buildFolderPath), so its notes sit in the parent's directory.
			const slugPath = parts.filter(Boolean).join('/');
			if (slugPath && !idBySlugPath.has(slugPath)) idBySlugPath.set(slugPath, id);
		}
	}

	for (const filePath of paths) {
		const parts = filePath.split('/');
		parts.pop(); // the filename

		let rawPath = '';
		let slugPath = '';
		let parentId: string | null = null;

		for (const part of parts) {
			rawPath = rawPath ? `${rawPath}/${part}` : part;
			slugPath = slugPath ? `${slugPath}/${slugOf(part)}` : slugOf(part);

			let folderId = idBySlugPath.get(slugPath);
			if (!folderId) {
				// The same id on every device that pulls this directory, and on
				// every pull until the metadata lists it, so it can't end up as
				// several folders. (Slugs can't contain "--".)
				folderId = metadata
					? `dir-${metadata.vault.id}-${slugPath.replace(/\//g, '--')}`
					: crypto.randomUUID();
				idBySlugPath.set(slugPath, folderId);
				folders.push({
					id: folderId,
					name: part.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
					parentId,
					vaultId: metadata?.vault.id ?? '', // Set by caller when there's no metadata
					created: now,
					modified: now,
					deletedAt: null
				});
			}
			pathToFolderId[rawPath] = folderId;
			parentId = folderId;
		}
	}

	return { folders, pathToFolderId };
}
