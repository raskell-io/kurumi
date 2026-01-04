/**
 * Markdown export utilities for exporting notes in various SSG-compatible formats
 * Supports: Vanilla Markdown, Hugo, Zola
 */

import type { Note, Folder, Vault } from '../db/types';
import JSZip from 'jszip';

export type MarkdownExportFormat = 'vanilla' | 'hugo' | 'zola';

export interface ExportOptions {
	format: MarkdownExportFormat;
	includeMetadata?: boolean; // For vanilla format
}

export interface ExportFile {
	path: string;
	content: string;
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
 * Build the folder path for a note
 */
export function buildFolderPath(
	note: Note,
	folders: Folder[]
): string[] {
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
 * Calculate the relative path from one note to another
 */
export function calculateRelativePath(
	fromNote: Note,
	toNote: Note,
	folders: Folder[]
): string {
	const fromPath = buildFolderPath(fromNote, folders);
	const toPath = buildFolderPath(toNote, folders);
	const toSlug = generateSlug(toNote.title || 'untitled');

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
	notes: Note[],
	currentNote: Note,
	folders: Folder[]
): string {
	return content.replace(/\[\[([^\]]+)\]\]/g, (match, title) => {
		const targetNote = notes.find(
			(n) => n.title.toLowerCase() === title.toLowerCase()
		);
		if (!targetNote) {
			// Keep original if target not found
			return match;
		}
		const relativePath = calculateRelativePath(currentNote, targetNote, folders);
		return `[${title}](${relativePath})`;
	});
}

/**
 * Generate YAML front matter for vanilla markdown
 */
function generateVanillaFrontMatter(note: Note, includeMetadata: boolean): string {
	if (!includeMetadata) return '';

	const lines = ['---'];
	lines.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
	lines.push(`date: ${formatDate(note.created)}`);
	lines.push(`modified: ${formatDate(note.modified)}`);
	if (note.tags.length > 0) {
		lines.push(`tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

/**
 * Generate YAML front matter for Hugo
 */
function generateHugoFrontMatter(note: Note): string {
	const lines = ['---'];
	lines.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
	lines.push(`date: ${formatDateTime(note.created)}`);
	lines.push(`lastmod: ${formatDateTime(note.modified)}`);
	if (note.tags.length > 0) {
		lines.push(`tags: [${note.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('draft: false');
	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

/**
 * Generate TOML front matter for Zola
 */
function generateZolaFrontMatter(note: Note): string {
	const lines = ['+++'];
	lines.push(`title = "${note.title.replace(/"/g, '\\"')}"`);
	lines.push(`date = ${formatDate(note.created)}`);
	if (note.modified !== note.created) {
		lines.push(`updated = ${formatDate(note.modified)}`);
	}
	if (note.tags.length > 0) {
		lines.push('');
		lines.push('[taxonomies]');
		lines.push(`tags = [${note.tags.map((t) => `"${t}"`).join(', ')}]`);
	}
	lines.push('+++');
	lines.push('');

	return lines.join('\n');
}

/**
 * Export a single note to markdown with the specified format
 */
export function exportNoteToMarkdown(
	note: Note,
	notes: Note[],
	folders: Folder[],
	options: ExportOptions
): string {
	let frontMatter = '';

	switch (options.format) {
		case 'vanilla':
			frontMatter = generateVanillaFrontMatter(note, options.includeMetadata ?? true);
			break;
		case 'hugo':
			frontMatter = generateHugoFrontMatter(note);
			break;
		case 'zola':
			frontMatter = generateZolaFrontMatter(note);
			break;
	}

	const content = convertWikilinks(note.content, notes, note, folders);

	return frontMatter + content;
}

/**
 * Export all notes to files with folder structure
 */
export function exportNotesToFiles(
	notes: Note[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions
): ExportFile[] {
	const files: ExportFile[] = [];
	const vaultSlug = generateSlug(vault.name);

	for (const note of notes) {
		const folderPath = buildFolderPath(note, folders);
		const noteSlug = generateSlug(note.title || 'untitled');
		const filename = `${noteSlug}.md`;

		const pathParts = [vaultSlug, ...folderPath, filename];
		const path = pathParts.join('/');

		const content = exportNoteToMarkdown(note, notes, folders, options);
		files.push({ path, content });
	}

	return files;
}

/**
 * Create a ZIP file from export files and trigger download
 */
export async function downloadAsZip(
	files: ExportFile[],
	format: MarkdownExportFormat
): Promise<void> {
	const zip = new JSZip();

	for (const file of files) {
		zip.file(file.path, file.content);
	}

	const blob = await zip.generateAsync({ type: 'blob' });
	const timestamp = new Date().toISOString().split('T')[0];
	const filename = `kurumi-export-${format}-${timestamp}.zip`;

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
 * Export vault notes as a ZIP file
 */
export async function exportVaultAsMarkdown(
	notes: Note[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions
): Promise<void> {
	const files = exportNotesToFiles(notes, folders, vault, options);
	await downloadAsZip(files, options.format);
}

/**
 * Export a single note as a markdown file (no ZIP)
 */
export function downloadSingleNote(
	note: Note,
	notes: Note[],
	folders: Folder[],
	options: ExportOptions
): void {
	const content = exportNoteToMarkdown(note, notes, folders, options);
	const slug = generateSlug(note.title || 'untitled');
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
