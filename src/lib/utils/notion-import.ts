/**
 * Notion import, from Notion's "Markdown & CSV" export (Settings →
 * Export → Markdown & CSV, include subpages). The export is a ZIP (large
 * workspaces: a ZIP of ZIPs) where
 *
 *   - every page is `Title <32-hex id>.md`, its first line `# Title`;
 *   - a page's subpages and files sit in a folder of the same name;
 *   - links to pages are relative, URL-encoded `.md` paths;
 *   - databases are a CSV plus a folder with one page per row.
 *
 * Pages become notes (folders mirror the page tree), page links become
 * [[wikilinks]], images and files are stored and relinked as blob refs
 * (images inline, other files as attachments). The CSVs are skipped: their
 * rows arrive as pages.
 */

import JSZip from 'jszip';
import { addFolder, addMemoryObject, batchUpdates } from '$lib/db';
import { storeBlob } from '$lib/db/blob-store';

export interface NotionImportResult {
	success: boolean;
	notesCreated: number;
	foldersCreated: number;
	filesStored: number;
	skipped: string[];
	error?: string;
}

const NOTION_ID = /\s+[0-9a-f]{32}$/i;

/** `Meeting notes 1a2b…(32 hex).md` → `Meeting notes` */
export function cleanNotionName(name: string): string {
	return name.replace(/\.(md|csv)$/i, '').replace(NOTION_ID, '').trim() || 'Untitled';
}

/** Resolve a relative, URL-encoded link against the linking file's directory. */
export function resolveNotionPath(fromDir: string, target: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(target);
	} catch {
		decoded = target;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('#')) return null; // URL or anchor
	const parts = fromDir ? fromDir.split('/') : [];
	for (const seg of decoded.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg && seg !== '.') parts.push(seg);
	}
	return parts.join('/');
}

/** Page title: the `# Title` first line (removed from the body), else the file name. */
export function splitNotionTitle(path: string, text: string): { title: string; body: string } {
	const match = text.match(/^﻿?#\s+(.+?)\s*(?:\n|$)/);
	if (match) return { title: match[1].trim(), body: text.slice(match[0].length).replace(/^\s*\n/, '') };
	return { title: cleanNotionName(path.split('/').pop()!), body: text };
}

/**
 * Rewrite a page's links: other pages → [[Title]], files → whatever
 * `fileRef` returns (a blob ref), anything else unchanged.
 */
export function rewriteNotionLinks(
	body: string,
	fromDir: string,
	pageTitle: (path: string) => string | undefined,
	fileRef: (path: string) => string | undefined
): string {
	return body.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, text: string, target: string) => {
		const path = resolveNotionPath(fromDir, target);
		if (!path) return whole;
		if (!bang && /\.md$/i.test(path)) {
			const title = pageTitle(path);
			// Kurumi has no [[Title|alias]]; the link text gives way to the title.
			return title ? `[[${title}]]` : whole;
		}
		const ref = fileRef(path);
		return ref ? `${bang}[${text}](${ref})` : whole;
	});
}

interface Entry {
	path: string;
	file: JSZip.JSZipObject;
}

/** All files in the export, opening ZIPs inside the ZIP (Notion splits big exports). */
async function readEntries(zip: JSZip, prefix = ''): Promise<Entry[]> {
	const entries: Entry[] = [];
	for (const file of Object.values(zip.files)) {
		if (file.dir || file.name.startsWith('__MACOSX/') || file.name.split('/').pop()!.startsWith('.')) continue;
		if (/\.zip$/i.test(file.name)) {
			entries.push(...(await readEntries(await JSZip.loadAsync(await file.async('blob')), prefix)));
		} else {
			entries.push({ path: prefix + file.name, file });
		}
	}
	return entries;
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	pdf: 'application/pdf'
};

export async function importNotionExport(zipFile: File | Blob): Promise<NotionImportResult> {
	const result: NotionImportResult = { success: false, notesCreated: 0, foldersCreated: 0, filesStored: 0, skipped: [] };
	try {
		const entries = await readEntries(await JSZip.loadAsync(zipFile));
		const pages = entries.filter((e) => /\.md$/i.test(e.path));
		if (pages.length === 0) {
			return { ...result, error: 'No pages found. Export from Notion as "Markdown & CSV".' };
		}
		const byPath = new Map(entries.map((e) => [e.path, e]));
		const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

		// Titles first, so links between pages resolve in any order.
		const texts = new Map<string, string>();
		const titles = new Map<string, string>();
		for (const page of pages) {
			const text = await page.file.async('string');
			texts.set(page.path, text);
			titles.set(page.path, splitNotionTitle(page.path, text).title);
		}

		// Store the files pages link to, once each.
		const refs = new Map<string, string>();
		for (const [path, text] of texts) {
			for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
				const target = resolveNotionPath(dirOf(path), match[1]);
				if (!target || /\.md$/i.test(target) || refs.has(target)) continue;
				const entry = byPath.get(target);
				if (!entry) continue;
				const ext = target.split('.').pop()!.toLowerCase();
				const blob = await entry.file.async('blob');
				refs.set(target, await storeBlob(blob, MIME[ext] ?? 'application/octet-stream'));
			}
		}
		result.filesStored = refs.size;
		for (const entry of entries) {
			if (/\.csv$/i.test(entry.path)) result.skipped.push(`${cleanNotionName(entry.path.split('/').pop()!)} (database table; its rows are imported as pages)`);
		}

		batchUpdates(() => {
			// Folders mirror the page tree: `Projects <id>/` holds the subpages of `Projects <id>.md`.
			const folderIds = new Map<string, string>();
			const folderFor = (dir: string): string | null => {
				if (!dir) return null;
				const known = folderIds.get(dir);
				if (known) return known;
				const parent = folderFor(dirOf(dir));
				const id = addFolder(cleanNotionName(dir.split('/').pop()!), parent).id;
				folderIds.set(dir, id);
				result.foldersCreated++;
				return id;
			};
			for (const page of pages) {
				const { title, body } = splitNotionTitle(page.path, texts.get(page.path)!);
				const linked = rewriteNotionLinks(body, dirOf(page.path), (p) => titles.get(p), (p) => refs.get(p));
				addMemoryObject(title, linked.trim(), folderFor(dirOf(page.path)));
				result.notesCreated++;
			}
		});
		result.success = true;
		return result;
	} catch (err) {
		return { ...result, error: err instanceof Error ? err.message : 'Could not read the export' };
	}
}
