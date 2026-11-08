/**
 * Highlighted study mode (/read/highlights): every `==highlighted==` passage
 * across the notes, and every PDF highlight, stitched into one document to
 * review. Kept free of the store so it can be tested on its own.
 */

export interface NoteHighlight {
	kind: 'note';
	text: string; // the highlighted words
	context: string; // the line it's in, highlight marks removed, for the gist around it
	heading: string | null; // nearest heading above
	line: number;
}

export interface PdfPassage {
	kind: 'pdf';
	text: string;
	comment: string;
	page: number;
	ref: string; // blob:<id>
	file: string; // the attachment's name in the note
	color: string;
}

export type Highlight = NoteHighlight | PdfPassage;

export interface HighlightGroup {
	noteId: string;
	title: string;
	updatedAt: number;
	tags: string[];
	highlights: Highlight[];
}

const FENCE = /^\s*(```|~~~)/;
// No space just inside the marks (as Obsidian): `a == b and c == d` isn't a highlight.
const MARK = /==(?=\S)((?:[^=\n]|=(?!=))+?)(?<=\S)==/g;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const ATTACHMENT = /\[([^\]\n]+)\]\((blob:[^)#\s]+)(?:#[^)\s]*)?\)/g;

/** `==highlights==` in a markdown body (not in code), with their line and heading. */
export function noteHighlights(body: string): NoteHighlight[] {
	const out: NoteHighlight[] = [];
	let inFence = false;
	let heading: string | null = null;
	body.split('\n').forEach((line, index) => {
		if (FENCE.test(line)) {
			inFence = !inFence;
			return;
		}
		if (inFence) return;
		const h = line.match(HEADING);
		if (h) heading = stripMarks(h[1]);
		// Inline code spans don't count.
		const visible = line.replace(/`[^`\n]*`/g, (code) => ' '.repeat(code.length));
		for (const match of visible.matchAll(MARK)) {
			const text = match[1].trim();
			if (!text) continue;
			const context = stripMarks(line)
				.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
				.replace(/^\s*>\s?/, '')
				.replace(HEADING, '$1')
				.trim();
			out.push({ kind: 'note', text, context, heading: h ? null : heading, line: index });
		}
	});
	return out;
}

const bareRef = (ref: string) => ref.replace(/^blob:/, '');

/** `line` with highlight marks removed, except inside `code`. */
const stripMarks = (line: string) =>
	line
		.split(/(`[^`\n]*`)/)
		.map((part, i) => (i % 2 ? part : part.replace(MARK, '$1')))
		.join('');

/** Attachments linked in a body, by blob id: the name they're shown with. */
export function attachmentsIn(body: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of body.matchAll(ATTACHMENT)) {
		const id = bareRef(match[2]);
		if (!found.has(id)) found.set(id, match[1].replace(/, p\. \d+$/, ''));
	}
	return found;
}

interface NoteLike {
	id: string;
	title: string;
	bodyMarkdown: string;
	updatedAt: number;
	tags?: string[];
	type?: string;
}

interface PdfHighlightLike {
	ref: string;
	page: number;
	text: string;
	comment: string;
	color: string;
}

/**
 * Highlights grouped by note, most recently edited first. A PDF's highlights
 * go under the first note that links the PDF (and are skipped when no note
 * in the list links it).
 */
export function collectHighlights(notes: NoteLike[], pdf: PdfHighlightLike[] = []): HighlightGroup[] {
	const groups: HighlightGroup[] = [];
	const owner = new Map<string, { group: HighlightGroup; name: string }>();
	const sorted = [...notes].filter((n) => n.type !== 'canvas').sort((a, b) => b.updatedAt - a.updatedAt);
	for (const note of sorted) {
		const group: HighlightGroup = { noteId: note.id, title: note.title || 'Untitled', updatedAt: note.updatedAt, tags: note.tags ?? [], highlights: noteHighlights(note.bodyMarkdown ?? '') };
		groups.push(group);
		for (const [id, name] of attachmentsIn(note.bodyMarkdown ?? '')) if (!owner.has(id)) owner.set(id, { group, name });
	}
	for (const h of [...pdf].sort((a, b) => a.page - b.page)) {
		const home = owner.get(bareRef(h.ref));
		if (!home || !h.text.trim()) continue;
		home.group.highlights.push({ kind: 'pdf', text: h.text.trim(), comment: h.comment, page: h.page, ref: `blob:${bareRef(h.ref)}`, file: home.name, color: h.color });
	}
	return groups.filter((g) => g.highlights.length > 0);
}

/** The highlights as one markdown document (for "Save as note"). Plain quotes and links, no checkboxes. */
export function highlightsToMarkdown(groups: HighlightGroup[]): string {
	const parts: string[] = [];
	for (const group of groups) {
		parts.push(`## [[${group.title.replace(/[[\]|]/g, '')}]]`, '');
		for (const h of group.highlights) {
			if (h.kind === 'note') {
				parts.push(`> ${h.text}`);
				if (h.context && h.context !== h.text) parts.push(`>`, `> — ${h.context}`);
			} else {
				parts.push(`> ${h.text}`, `>`, `> — [${h.file}, p. ${h.page}](${h.ref}#page=${h.page})`);
				if (h.comment) parts.push(`>`, `> ${h.comment}`);
			}
			parts.push('');
		}
	}
	return parts.join('\n').trimEnd() + '\n';
}
