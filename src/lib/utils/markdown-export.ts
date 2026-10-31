/**
 * Markdown export utilities for exporting memories in various SSG-compatible formats
 * Supports: Vanilla Markdown, Hugo, Zola
 */

import type { MemoryObject, Folder, Vault } from '../db/types';
import JSZip from 'jszip';
import { getBlob } from '../db/blob-store';

export type MarkdownExportFormat = 'vanilla' | 'hugo' | 'zola';

export interface ExportOptions {
	format: MarkdownExportFormat;
	includeMetadata?: boolean; // For vanilla format
}

export interface ExportFile {
	path: string;
	content: string | Blob;
}

// ---------------------------------------------------------------- assets
//
// Images, recordings and attachments live in the blob store, referenced
// from notes as `blob:<id>`. The ZIP export carries them as files under
// `<vault>/assets/` and points the notes at them with relative links, so
// the export works in any markdown editor.

const BLOB_REF_RE = /blob:([0-9A-Za-z]+)(?![0-9A-Za-z:])/g;

const MIME_EXT: Record<string, string> = {
	'image/avif': 'avif',
	'image/webp': 'webp',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
	'audio/webm': 'webm',
	'audio/ogg': 'ogg',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'audio/wav': 'wav',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'application/pdf': 'pdf'
};

/** Blob refs a note uses: in its body, plus its recording. */
export function blobRefsOf(memory: MemoryObject): string[] {
	const refs = new Set<string>();
	for (const match of (memory.bodyMarkdown ?? '').matchAll(BLOB_REF_RE)) refs.add(`blob:${match[1]}`);
	for (const ref of [memory.rawAudioRef, memory.rawMediaRef]) if (ref?.startsWith('blob:')) refs.add(ref);
	return [...refs];
}

/** File name for an asset: its id, with an extension from the type or the link text. */
function assetFileName(ref: string, mimeType: string, bodies: string[]): string {
	const id = ref.slice('blob:'.length);
	let ext = MIME_EXT[mimeType.split(';')[0]];
	if (!ext) {
		// Attachments: `[report.docx](blob:id)` names its own extension.
		const named = bodies
			.map((b) => b.match(new RegExp(`\\[([^\\]]*\\.([A-Za-z0-9]{1,8}))\\]\\(${ref}\\)`)))
			.find(Boolean);
		ext = named?.[2]?.toLowerCase() ?? 'bin';
	}
	return `${id}.${ext}`;
}

export interface ExportAssets {
	/** ref → file name under `assets/` */
	names: Map<string, string>;
	/** ref → the file */
	blobs: Map<string, Blob>;
}

/** Read every blob the memories use. Missing blobs (not synced to this device) are left out. */
export async function collectAssets(
	memories: MemoryObject[],
	readBlob: (ref: string) => Promise<{ blob: Blob; mimeType: string } | null>
): Promise<ExportAssets> {
	const assets: ExportAssets = { names: new Map(), blobs: new Map() };
	const bodies = memories.map((m) => m.bodyMarkdown ?? '');
	for (const ref of new Set(memories.flatMap(blobRefsOf))) {
		const stored = await readBlob(ref);
		if (!stored) continue;
		assets.names.set(ref, assetFileName(ref, stored.mimeType, bodies));
		assets.blobs.set(ref, stored.blob);
	}
	return assets;
}

/** Point a body's blob refs at the exported files, relative to the note. */
export function linkAssets(body: string, names: Map<string, string>, depth: number): string {
	const up = '../'.repeat(depth);
	return body.replace(BLOB_REF_RE, (whole, id: string) => {
		const name = names.get(`blob:${id}`);
		return name ? `${up}assets/${name}` : whole;
	});
}

/**
 * Generate a URL-friendly slug from a title
 */
export function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s-]/g, '') // Remove special chars
		.replace(/\s+/g, '-') // Spaces to hyphens
		.replace(/-+/g, '-') // Collapse multiple hyphens
		.replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Assign each vault a unique, filesystem-safe directory name derived from
 * its name ("Work" → "work", a second "Work" → "work-2"). Vaults are taken
 * oldest first so names stay stable as new vaults are added. Shared by the
 * all-vaults ZIP export and the local-folder mirror so both lay vaults out
 * the same way.
 */
export function vaultDirNames(vaults: Pick<Vault, 'id' | 'name' | 'created'>[]): Map<string, string> {
	const names = new Map<string, string>();
	const used = new Set<string>();
	const ordered = [...vaults].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
	for (const vault of ordered) {
		const base = generateSlug(vault.name) || 'vault';
		let name = base;
		for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
		used.add(name);
		names.set(vault.id, name);
	}
	return names;
}

/**
 * Format a timestamp to ISO date string
 */
function formatDate(timestamp: number): string {
	return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Format a timestamp to full ISO string (for Hugo)
 */
function formatDateTime(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

/**
 * Build the folder path for a memory
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
 * Calculate the relative path from one memory to another
 */
export function calculateRelativePath(
	from: MemoryObject,
	to: MemoryObject,
	folders: Folder[]
): string {
	const fromPath = buildFolderPath(from, folders);
	const toPath = buildFolderPath(to, folders);
	const toSlug = generateSlug(to.title || 'untitled');

	// Find common prefix length
	let commonLength = 0;
	while (
		commonLength < fromPath.length &&
		commonLength < toPath.length &&
		fromPath[commonLength] === toPath[commonLength]
	) {
		commonLength++;
	}

	// Calculate path: go up from source, then down to target
	const upCount = fromPath.length - commonLength;
	const upParts = Array(upCount).fill('..');
	const downParts = toPath.slice(commonLength);

	const parts = [...upParts, ...downParts, `${toSlug}.md`];

	// If same folder, use ./
	if (parts.length === 1) {
		return `./${parts[0]}`;
	}

	return parts.join('/');
}

/**
 * Convert wikilinks to relative markdown links
 */
export function convertWikilinks(
	content: string,
	memories: MemoryObject[],
	current: MemoryObject,
	folders: Folder[]
): string {
	return content.replace(/\[\[([^\]]+)\]\]/g, (match, title) => {
		const target = memories.find((m) => m.title.toLowerCase() === title.toLowerCase());
		if (!target) {
			// Keep original if target not found
			return match;
		}
		const relativePath = calculateRelativePath(current, target, folders);
		return `[${title}](${relativePath})`;
	});
}

/**
 * Generate YAML front matter for vanilla markdown
 */
function generateVanillaFrontMatter(memory: MemoryObject, includeMetadata: boolean): string {
	if (!includeMetadata) return '';

	const lines = ['---'];
	lines.push(`title: "${memory.title.replace(/"/g, '\\"')}"`);
	lines.push(`date: ${formatDate(memory.createdAt)}`);
	lines.push(`modified: ${formatDate(memory.updatedAt)}`);
	if (memory.tags.length > 0) {
		lines.push(`tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

/**
 * Generate YAML front matter for Hugo
 */
function generateHugoFrontMatter(memory: MemoryObject): string {
	const lines = ['---'];
	lines.push(`title: "${memory.title.replace(/"/g, '\\"')}"`);
	lines.push(`date: ${formatDateTime(memory.createdAt)}`);
	lines.push(`lastmod: ${formatDateTime(memory.updatedAt)}`);
	if (memory.tags.length > 0) {
		lines.push(`tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('draft: false');
	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

/**
 * Generate TOML front matter for Zola
 */
function generateZolaFrontMatter(memory: MemoryObject): string {
	const lines = ['+++'];
	lines.push(`title = "${memory.title.replace(/"/g, '\\"')}"`);
	lines.push(`date = ${formatDate(memory.createdAt)}`);
	if (memory.updatedAt !== memory.createdAt) {
		lines.push(`updated = ${formatDate(memory.updatedAt)}`);
	}
	if (memory.tags.length > 0) {
		lines.push('');
		lines.push('[taxonomies]');
		lines.push(`tags = [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('+++');
	lines.push('');

	return lines.join('\n');
}

/**
 * Build supplementary sections for memory types that carry data outside
 * `bodyMarkdown` (voice memos carry transcripts, meetings carry structured
 * extras). Returns '' for plain text notes.
 */
function buildExtraSections(memory: MemoryObject): string {
	const sections: string[] = [];

	if (memory.summaryShort) {
		sections.push('## Summary', '', memory.summaryShort, '');
	}

	if (memory.meetingExtras) {
		const { actionItems, unresolvedQuestions, followUpSuggestions } = memory.meetingExtras;
		if (actionItems.length > 0) {
			sections.push('## To-dos', '');
			for (const item of actionItems) {
				const parts = [`- [ ] ${item.text}`];
				if (item.assignee) parts.push(`— ${item.assignee}`);
				if (item.dueDate) parts.push(`(due ${item.dueDate})`);
				sections.push(parts.join(' '));
			}
			sections.push('');
		}
		if (unresolvedQuestions.length > 0) {
			sections.push('## Open questions', '');
			for (const q of unresolvedQuestions) sections.push(`- ${q}`);
			sections.push('');
		}
		if (followUpSuggestions.length > 0) {
			sections.push('## Follow-ups', '');
			for (const s of followUpSuggestions) sections.push(`- ${s}`);
			sections.push('');
		}
	}

	if (memory.transcript && memory.transcript.trim()) {
		sections.push('## Transcript', '', memory.transcript.trim(), '');
	}

	return sections.length > 0 ? '\n\n' + sections.join('\n') : '';
}

/**
 * Export a single memory to markdown with the specified format
 */
export function exportMemoryToMarkdown(
	memory: MemoryObject,
	memories: MemoryObject[],
	folders: Folder[],
	options: ExportOptions,
	assets?: { names: Map<string, string>; depth: number }
): string {
	let frontMatter = '';

	switch (options.format) {
		case 'vanilla':
			frontMatter = generateVanillaFrontMatter(memory, options.includeMetadata ?? true);
			break;
		case 'hugo':
			frontMatter = generateHugoFrontMatter(memory);
			break;
		case 'zola':
			frontMatter = generateZolaFrontMatter(memory);
			break;
	}

	let body = convertWikilinks(memory.bodyMarkdown, memories, memory, folders);
	let extras = buildExtraSections(memory);
	if (assets) {
		body = linkAssets(body, assets.names, assets.depth);
		const recording = memory.rawAudioRef ? assets.names.get(memory.rawAudioRef) : undefined;
		if (recording) extras += `\n\n[Recording](${'../'.repeat(assets.depth)}assets/${recording})\n`;
	}

	return frontMatter + body + extras;
}

/**
 * Export all memories to files with folder structure
 */
export function exportMemoriesToFiles(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions,
	vaultDir: string = generateSlug(vault.name),
	assets?: ExportAssets
): ExportFile[] {
	const files: ExportFile[] = [];
	const vaultSlug = vaultDir;

	for (const memory of memories) {
		const folderPath = buildFolderPath(memory, folders);
		const slug = generateSlug(memory.title || 'untitled');
		const filename = `${slug}.md`;

		const pathParts = [vaultSlug, ...folderPath, filename];
		const path = pathParts.join('/');

		// Depth below the vault root: notes in folders link up to assets/
		const content = exportMemoryToMarkdown(memory, memories, folders, options, assets && { names: assets.names, depth: folderPath.length });
		files.push({ path, content });
	}

	if (assets) {
		const used = new Set(memories.flatMap(blobRefsOf));
		for (const [ref, name] of assets.names) {
			if (used.has(ref)) files.push({ path: `${vaultSlug}/assets/${name}`, content: assets.blobs.get(ref)! });
		}
	}

	return files;
}

/**
 * Create a ZIP file from export files and trigger download
 */
export async function downloadAsZip(
	files: ExportFile[],
	format: MarkdownExportFormat,
	label = 'export'
): Promise<void> {
	const zip = new JSZip();

	for (const file of files) {
		zip.file(file.path, file.content);
	}

	const blob = await zip.generateAsync({ type: 'blob' });
	const timestamp = new Date().toISOString().split('T')[0];
	const filename = `kurumi-${label}-${format}-${timestamp}.zip`;

	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Export vault memories as a ZIP file
 */
export async function exportVaultAsMarkdown(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions
): Promise<void> {
	const assets = await collectAssets(memories, getBlob);
	const files = exportMemoriesToFiles(memories, folders, vault, options, undefined, assets);
	await downloadAsZip(files, options.format);
}

/**
 * Export every vault into one ZIP, one top-level directory per vault.
 */
export async function exportAllVaultsAsMarkdown(
	vaults: Vault[],
	memories: MemoryObject[],
	folders: Folder[],
	options: ExportOptions
): Promise<void> {
	const dirs = vaultDirNames(vaults);
	const assets = await collectAssets(memories, getBlob);
	const files = vaults.flatMap((vault) =>
		exportMemoriesToFiles(
			memories.filter((m) => m.vaultId === vault.id),
			folders.filter((f) => f.vaultId === vault.id),
			vault,
			options,
			dirs.get(vault.id),
			assets
		)
	);
	await downloadAsZip(files, options.format, 'all-vaults');
}

/**
 * Export a single memory as a markdown file (no ZIP)
 */
export function downloadSingleMemory(
	memory: MemoryObject,
	memories: MemoryObject[],
	folders: Folder[],
	options: ExportOptions
): void {
	const content = exportMemoryToMarkdown(memory, memories, folders, options);
	const slug = generateSlug(memory.title || 'untitled');
	const filename = `${slug}.md`;

	const blob = new Blob([content], { type: 'text/markdown' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
