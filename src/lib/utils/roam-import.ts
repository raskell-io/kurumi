/**
 * Roam Research JSON export importer.
 *
 * Roam's native export format is a JSON array of page objects:
 *
 *   [
 *     {
 *       "title": "Page title",
 *       "create-time": 1234567890,
 *       "edit-time": 1234567890,
 *       "children": [
 *         { "string": "Block text", "children": [ ... ] },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 *
 * Each block has its own children forming an outline tree. We flatten
 * the tree into a single markdown body using indented bullet lists,
 * which is the closest cross-tool representation of the Roam model.
 *
 * Roam-specific syntax we preserve as-is:
 * - [[Page Links]] → kept (Kurumi uses the same wikilink syntax)
 * - #tag → kept
 * - {{TODO}} / {{DONE}} → converted to `- [ ]` / `- [x]` markdown checklists
 *
 * This is a minimal importer — block references (`((uid))`),
 * attribute pages (`key:: value`), and embedded queries are left as
 * raw text for the user to clean up.
 */

import { addMemoryObject } from '$lib/db';

export interface RoamImportResult {
	success: boolean;
	pagesCreated: number;
	blockCount: number;
	skipped: string[];
	error?: string;
}

interface RoamBlock {
	string?: string;
	children?: RoamBlock[];
	'create-time'?: number;
	'edit-time'?: number;
	uid?: string;
}

interface RoamPage {
	title?: string;
	'create-time'?: number;
	'edit-time'?: number;
	children?: RoamBlock[];
}

export async function importRoamJSON(file: File): Promise<RoamImportResult> {
	try {
		const text = await file.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			return {
				success: false,
				pagesCreated: 0,
				blockCount: 0,
				skipped: [],
				error: `Not valid JSON: ${err instanceof Error ? err.message : 'parse failed'}`
			};
		}

		if (!Array.isArray(parsed)) {
			return {
				success: false,
				pagesCreated: 0,
				blockCount: 0,
				skipped: [],
				error: 'Expected a top-level JSON array (Roam export format)'
			};
		}

		const pages = parsed as RoamPage[];
		const skipped: string[] = [];
		let pagesCreated = 0;
		let blockCount = 0;

		for (const page of pages) {
			const title = page.title?.trim();
			if (!title) {
				skipped.push('(page with no title)');
				continue;
			}

			const { body, count } = renderBlocks(page.children ?? [], 0);
			blockCount += count;

			// Empty pages are fine — users often have stub pages from
			// aliases — so we create them anyway with an empty body.
			addMemoryObject(title, body, null);
			pagesCreated++;
		}

		return {
			success: true,
			pagesCreated,
			blockCount,
			skipped
		};
	} catch (err) {
		return {
			success: false,
			pagesCreated: 0,
			blockCount: 0,
			skipped: [],
			error: err instanceof Error ? err.message : 'Import failed'
		};
	}
}

/**
 * Render a Roam block tree as an indented markdown bullet list.
 * Returns the rendered body plus a count of blocks encountered so
 * the caller can report stats.
 */
function renderBlocks(
	blocks: RoamBlock[],
	depth: number
): { body: string; count: number } {
	const lines: string[] = [];
	let count = 0;

	for (const block of blocks) {
		if (!block.string && (!block.children || block.children.length === 0)) {
			continue; // skip empty leaves
		}

		const indent = '  '.repeat(depth);
		const normalized = normalizeRoamBlockText(block.string ?? '');
		// Use '- ' at every level — Roam's "outline" maps naturally to
		// nested markdown bullets.
		lines.push(`${indent}- ${normalized}`);
		count++;

		if (block.children && block.children.length > 0) {
			const child = renderBlocks(block.children, depth + 1);
			if (child.body) lines.push(child.body);
			count += child.count;
		}
	}

	return { body: lines.join('\n'), count };
}

/**
 * Convert Roam-specific syntax within a single block string to the
 * closest markdown equivalent. Leaves wikilinks and tags untouched
 * since Kurumi uses the same forms.
 */
function normalizeRoamBlockText(text: string): string {
	return text
		.replace(/\{\{\[?\[?TODO\]?\]?\}\}/g, '[ ]')
		.replace(/\{\{\[?\[?DONE\]?\]?\}\}/g, '[x]')
		// Normalise Roam's triple backtick code blocks (already markdown)
		.trim();
}
