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
 * (images inline, other files as attachments). A database becomes a Kurumi
 * database: its folder of row pages gets a table view, the CSV's columns
 * become typed properties (inferPropertyType) and each row's values go on
 * its page, matched by title. Notion repeats the values at the top of each
 * row page ("Status: Done"); those lines are dropped.
 */

import JSZip from 'jszip';
import { addFolder, addMemoryObject, addDatabaseView, batchUpdates, setMemoryCustomProp } from '$lib/db';
import type { PropertyDefinition } from '$lib/db/types';
import { storeBlob } from '$lib/db/blob-store';
import { parseCsv } from './csv';
import { inferPropertyType, newPropertyKey, parseInput } from '$lib/database';

export interface NotionImportResult {
	success: boolean;
	notesCreated: number;
	foldersCreated: number;
	databasesCreated?: number;
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
		// A link to a database's CSV: the database is a folder now, keep the name.
		if (!bang && /\.csv$/i.test(path)) return text;
		if (!bang && /\.md$/i.test(path)) {
			const title = pageTitle(path);
			if (!title) return whole;
			// Keep Notion's link text when it differs from the title.
			const shown = text.trim();
			return shown && shown !== title && !/[[\]|\n]/.test(shown) ? `[[${title}|${shown}]]` : `[[${title}]]`;
		}
		const ref = fileRef(path);
		return ref ? `${bang}[${text}](${ref})` : whole;
	});
}

interface Entry {
	path: string;
	file: JSZip.JSZipObject;
}

export interface NotionDatabase {
	/** The folder of row pages (the CSV's path without `.csv`). */
	dir: string;
	properties: PropertyDefinition[];
	/** Per row: its title and its values by property key. */
	rows: { title: string; values: Record<string, unknown> }[];
}

/** Relation cells list pages as `Title (Title%20<id>.md)`; keep the titles. */
function cleanCell(value: string): string {
	return value.replace(/\s*\([^()]*\.md\)/g, '').trim();
}

/**
 * A database from its CSV: the first column is the title, the others become
 * properties with a type guessed from their values.
 */
export function readNotionDatabase(csvPath: string, csv: string): NotionDatabase | null {
	const [header, ...records] = parseCsv(csv);
	if (!header || header.length === 0) return null;
	const properties: PropertyDefinition[] = [];
	const columns: { index: number; prop: PropertyDefinition }[] = [];
	for (let i = 1; i < header.length; i++) {
		const label = header[i].trim() || `Column ${i + 1}`;
		const values = records.map((r) => cleanCell(r[i] ?? ''));
		const { type, options } = inferPropertyType(values);
		const prop: PropertyDefinition = { key: newPropertyKey(label, properties), label, type, ...(options ? { options } : {}) };
		properties.push(prop);
		columns.push({ index: i, prop });
	}
	const rows = records.map((r) => {
		const values: Record<string, unknown> = {};
		for (const { index, prop } of columns) {
			const value = parseInput(prop.type, cleanCell(r[index] ?? ''));
			if (value !== null && !(prop.type === 'checkbox' && value === false)) values[prop.key] = value;
		}
		return { title: (r[0] ?? '').trim() || 'Untitled', values };
	});
	return { dir: csvPath.replace(/(_all)?\.csv$/i, ''), properties, rows };
}

/** Drop the `Property: value` lines Notion puts at the top of a row's page. */
export function stripNotionPropertyLines(body: string, labels: string[]): string {
	if (labels.length === 0) return body;
	const lines = body.split('\n');
	let i = 0;
	while (i < lines.length && labels.some((l) => lines[i].startsWith(`${l}: `) || lines[i] === `${l}:`)) i++;
	return i === 0 ? body : lines.slice(i).join('\n').replace(/^\s*\n/, '');
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
				if (!target || /\.(md|csv)$/i.test(target) || refs.has(target)) continue;
				const entry = byPath.get(target);
				if (!entry) continue;
				const ext = target.split('.').pop()!.toLowerCase();
				const blob = await entry.file.async('blob');
				refs.set(target, await storeBlob(blob, MIME[ext] ?? 'application/octet-stream'));
			}
		}
		result.filesStored = refs.size;

		// Databases: Notion writes `X.csv` (the view) and, newer exports,
		// `X_all.csv` (every row); take the full one.
		const databases = new Map<string, NotionDatabase>();
		const csvs = entries.filter((e) => /\.csv$/i.test(e.path));
		for (const entry of csvs.sort((a, b) => Number(/_all\.csv$/i.test(a.path)) - Number(/_all\.csv$/i.test(b.path)))) {
			const db = readNotionDatabase(entry.path, await entry.file.async('string'));
			if (db) databases.set(db.dir, db);
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
			const rowsByDir = new Map<string, { id: string; title: string }[]>();
			for (const page of pages) {
				const { title, body } = splitNotionTitle(page.path, texts.get(page.path)!);
				const db = databases.get(dirOf(page.path));
				const content = db ? stripNotionPropertyLines(body, db.properties.map((p) => p.label)) : body;
				const linked = rewriteNotionLinks(content, dirOf(page.path), (p) => titles.get(p), (p) => refs.get(p));
				const memory = addMemoryObject(title, linked.trim(), folderFor(dirOf(page.path)));
				if (db) rowsByDir.set(db.dir, [...(rowsByDir.get(db.dir) ?? []), { id: memory.id, title }]);
				result.notesCreated++;
			}

			for (const db of databases.values()) {
				const folderId = folderFor(db.dir);
				if (!folderId) continue;
				addDatabaseView({ name: 'Table', folderId, properties: db.properties });
				result.databasesCreated = (result.databasesCreated ?? 0) + 1;
				// Rows by title, in order (titles can repeat).
				const pagesLeft = [...(rowsByDir.get(db.dir) ?? [])];
				for (const row of db.rows) {
					const at = pagesLeft.findIndex((p) => p.title === row.title);
					let id: string;
					if (at === -1) {
						// A row without a page in the export: a note with just its values.
						id = addMemoryObject(row.title, '', folderId).id;
						result.notesCreated++;
					} else {
						id = pagesLeft.splice(at, 1)[0].id;
					}
					for (const [key, value] of Object.entries(row.values)) setMemoryCustomProp(id, key, value);
				}
			}
		});
		result.success = true;
		return result;
	} catch (err) {
		return { ...result, error: err instanceof Error ? err.message : 'Could not read the export' };
	}
}
