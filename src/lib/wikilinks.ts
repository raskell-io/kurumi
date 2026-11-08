/**
 * [[Wikilinks]], Obsidian's syntax:
 *
 *   [[Note]]               a link to the note titled "Note"
 *   [[Note|shown text]]    the same link, showing other text (an alias)
 *   [[Note#Heading]]       a heading in it
 *   [[Note#^a1b2c3]]       a block in it: the paragraph or list item that
 *                          ends with the marker ` ^a1b2c3`
 *   ![[Note#Heading]]      embeds only that section (or block)
 *
 * Inside a table the bar is escaped, `[[Note\|text]]`, like Obsidian writes
 * it. Links resolve by title, case-insensitively; the alias and heading
 * never take part.
 */

export interface Wikilink {
	/** The note's title ('' for a link to a heading of the same note). */
	target: string;
	heading: string | null;
	/** A block id (`^id` after the #), without the caret. */
	block: string | null;
	alias: string | null;
}

/** Every [[…]] in a text; group 1 is what's between the brackets. */
export const WIKILINK_PATTERN = /\[\[([^[\]\n]+?)\]\]/g;

/** The parts of a link's inner text (`Note#Heading|alias`). */
export function parseWikilink(inner: string): Wikilink {
	const bar = inner.search(/\\?\|/);
	const ref = bar === -1 ? inner : inner.slice(0, bar);
	const alias = bar === -1 ? null : inner.slice(bar).replace(/^\\?\|/, '').trim() || null;
	const hash = ref.indexOf('#');
	const anchor = hash === -1 ? '' : ref.slice(hash + 1).trim();
	const block = anchor.startsWith('^') ? anchor.slice(1).trim() || null : null;
	return {
		target: (hash === -1 ? ref : ref.slice(0, hash)).trim(),
		heading: block || !anchor ? null : anchor,
		block,
		alias
	};
}

/** What a link shows: its alias, else the title (and heading). */
export function wikilinkLabel(inner: string): string {
	const { target, heading, block, alias } = parseWikilink(inner);
	if (alias) return alias;
	if (heading) return target ? `${target} › ${heading}` : heading;
	if (block) return target || 'this note';
	return target;
}

/** Replace every [[link]] in `text` with its label (plain-text excerpts). */
export function wikilinksToText(text: string): string {
	return text.replace(/\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g, (_, inner: string) => wikilinkLabel(inner));
}

// ---- Headings and blocks ---------------------------------------------------

/** ` ^a1b2c3` at the end of a line: a block's id. */
export const BLOCK_ID_PATTERN = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)[ \t]*$/;

/** A new block id: six letters and digits. */
export function newBlockId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let id = '';
	for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
	return id;
}

/** A heading's text as a link names it: no trailing #s or block id, spaces folded. */
export function headingKey(text: string): string {
	return text.replace(BLOCK_ID_PATTERN, '').replace(/\s+#+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Lines of markdown with whether each is inside fenced code. */
function linesOf(markdown: string): { text: string; code: boolean }[] {
	let fence: string | null = null;
	return markdown.split('\n').map((text) => {
		const marker = text.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
		if (fence) {
			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			return { text, code: true };
		}
		if (marker) {
			fence = marker;
			return { text, code: true };
		}
		return { text, code: false };
	});
}

/** The headings of a note, in order (for link suggestions). */
export function headingsOf(markdown: string): { level: number; text: string }[] {
	return linesOf(markdown)
		.filter((l) => !l.code)
		.map((l) => l.text.match(/^(#{1,6})\s+(.+?)\s*$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m) => ({ level: m[1].length, text: m[2].replace(BLOCK_ID_PATTERN, '').replace(/\s+#+$/, '').trim() }));
}

/** Lines [start, end) of a heading's section: the heading up to the next heading of its level or higher. */
function sectionRange(markdown: string, heading: string): [number, number] | null {
	const lines = linesOf(markdown);
	const key = headingKey(heading);
	const start = lines.findIndex((l) => !l.code && /^#{1,6}\s/.test(l.text) && headingKey(l.text.replace(/^#{1,6}\s+/, '')) === key);
	if (start === -1) return null;
	const level = lines[start].text.match(/^#+/)![0].length;
	let end = start + 1;
	while (end < lines.length && !(!lines[end].code && new RegExp(`^#{1,${level}}\\s`).test(lines[end].text))) end++;
	while (end > start + 1 && !lines[end - 1].text.trim()) end--;
	return [start, end];
}

/** Lines [start, end) of the block marked ` ^id`: its list item, or its paragraph. */
function blockRange(markdown: string, id: string): [number, number] | null {
	const lines = linesOf(markdown);
	const at = lines.findIndex((l) => !l.code && l.text.match(BLOCK_ID_PATTERN)?.[1] === id);
	if (at === -1) return null;
	if (/^\s*([-*+]|\d+[.)])\s/.test(lines[at].text) || /^#{1,6}\s/.test(lines[at].text)) return [at, at + 1];
	let start = at;
	while (start > 0 && lines[start - 1].text.trim() && !lines[start - 1].code && !/^#{1,6}\s/.test(lines[start - 1].text)) start--;
	return [start, at + 1];
}

/** A heading's section, without block ids. Null if not found. */
export function markdownSection(markdown: string, heading: string): string | null {
	const r = sectionRange(markdown, heading);
	return r ? stripBlockIds(markdown.split('\n').slice(r[0], r[1]).join('\n').trimEnd()) : null;
}

/** The block marked ` ^id`, without its id. Null if not found. */
export function markdownBlock(markdown: string, id: string): string | null {
	const r = blockRange(markdown, id);
	if (!r) return null;
	const text = markdown.split('\n').slice(r[0], r[1]).join('\n');
	return stripBlockIds(r[1] - r[0] === 1 && /^\s*([-*+]|\d+[.)]|#{1,6})\s/.test(text) ? text.trim() : text);
}

/**
 * The part of a note a synced embed edits, as written (block ids kept, so
 * writing it back keeps every link working): a section, a block (its own id
 * left off; replacePart puts it back), or the whole note.
 */
export function editablePart(markdown: string, part: { heading?: string | null; block?: string | null }): string | null {
	const lines = markdown.split('\n');
	if (part.heading) {
		const r = sectionRange(markdown, part.heading);
		return r ? lines.slice(r[0], r[1]).join('\n') : null;
	}
	if (part.block) {
		const r = blockRange(markdown, part.block);
		return r ? lines.slice(r[0], r[1]).join('\n').replace(BLOCK_ID_PATTERN, '') : null;
	}
	return markdown;
}

/** The note's markdown with that part replaced by `text`. */
export function replacePart(markdown: string, part: { heading?: string | null; block?: string | null }, text: string): string {
	const lines = markdown.split('\n');
	if (part.heading) {
		const r = sectionRange(markdown, part.heading);
		if (!r) return markdown;
		return [...lines.slice(0, r[0]), ...text.replace(/\s+$/, '').split('\n'), ...lines.slice(r[1])].join('\n');
	}
	if (part.block) {
		const r = blockRange(markdown, part.block);
		if (!r) return markdown;
		const body = text.replace(/\s+$/, '').replace(BLOCK_ID_PATTERN, '');
		return [...lines.slice(0, r[0]), ...`${body} ^${part.block}`.split('\n'), ...lines.slice(r[1])].join('\n');
	}
	return text;
}

/** Markdown without the ` ^id` block markers (outside code). */
export function stripBlockIds(markdown: string): string {
	return linesOf(markdown)
		.map((l) => (l.code ? l.text : l.text.replace(BLOCK_ID_PATTERN, '')))
		.join('\n');
}
