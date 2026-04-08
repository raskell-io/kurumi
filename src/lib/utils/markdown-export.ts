/**
 * Markdown export utilities for exporting memories in various SSG-compatible formats
 * Supports: Vanilla Markdown, Hugo, Zola
 */

import type { MemoryObject, Folder, Vault } from '../db/types';
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
 * Export a single memory to markdown with the specified format
 */
export function exportMemoryToMarkdown(
	memory: MemoryObject,
	memories: MemoryObject[],
	folders: Folder[],
	options: ExportOptions
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

	const content = convertWikilinks(memory.bodyMarkdown, memories, memory, folders);

	return frontMatter + content;
}

/**
 * Export all memories to files with folder structure
 */
export function exportMemoriesToFiles(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions
): ExportFile[] {
	const files: ExportFile[] = [];
	const vaultSlug = generateSlug(vault.name);

	for (const memory of memories) {
		const folderPath = buildFolderPath(memory, folders);
		const slug = generateSlug(memory.title || 'untitled');
		const filename = `${slug}.md`;

		const pathParts = [vaultSlug, ...folderPath, filename];
		const path = pathParts.join('/');

		const content = exportMemoryToMarkdown(memory, memories, folders, options);
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
 * Export vault memories as a ZIP file
 */
export async function exportVaultAsMarkdown(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	options: ExportOptions
): Promise<void> {
	const files = exportMemoriesToFiles(memories, folders, vault, options);
	await downloadAsZip(files, options.format);
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
