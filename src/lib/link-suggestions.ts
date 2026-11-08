/**
 * "Consider linking to …": other notes' titles that appear in the text you're
 * writing without a [[link]]. Found by word n-grams against a title index, so
 * it costs the length of the text, not the number of notes.
 *
 * Used by the editor (`editor/linkSuggest.ts`), which underlines the first
 * mention of each title and links it on request. Kept free of the editor and
 * the store so it can be tested on its own.
 */

export interface TitleEntry {
	id: string;
	title: string;
	words: number; // number of words in the title
}

export interface LinkSuggestion {
	from: number; // offsets in the text given
	to: number;
	id: string;
	title: string;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const MAX_WORDS = 6;
// Titles that are a date or a number (daily notes, "2024") would match everywhere.
const DATE_OR_NUMBER = /^[\d\s./:-]+$/;
const DEFAULT_TITLE = /^(untitled|new note|untitled canvas)( \d+)?$/i;

const normalize = (text: string) => (text.match(WORD) ?? []).join(' ').toLowerCase();

/**
 * Index of note titles that are worth suggesting: not the default title, not
 * a bare date or number, at most six words, and single words only from four
 * letters up. When two notes share a title, neither is suggested.
 */
export function buildTitleIndex(notes: { id: string; title: string }[]): Map<string, TitleEntry> {
	const index = new Map<string, TitleEntry>();
	const ambiguous = new Set<string>();
	for (const note of notes) {
		const title = note.title?.trim() ?? '';
		if (!title || DEFAULT_TITLE.test(title) || DATE_OR_NUMBER.test(title)) continue;
		const key = normalize(title);
		const words = key ? key.split(' ').length : 0;
		if (!words || words > MAX_WORDS || (words === 1 && key.length < 4)) continue;
		if (index.has(key)) ambiguous.add(key);
		else index.set(key, { id: note.id, title, words });
	}
	for (const key of ambiguous) index.delete(key);
	return index;
}

/** Spans of `text` that must not be suggested in: [[links]], `code`, URLs, [text](links). */
function excludedSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	for (const pattern of [/\[\[[^\]\n]*\]\]/g, /`[^`\n]*`/g, /\bhttps?:\/\/\S+/g, /\[[^\]\n]*\]\([^)\n]*\)/g]) {
		for (const match of text.matchAll(pattern)) spans.push([match.index!, match.index! + match[0].length]);
	}
	return spans;
}

/**
 * Mentions of indexed titles in `text`, the longest title first where they
 * overlap. `skip` holds note ids not to suggest (this note, notes already
 * linked, dismissed ones). Single-word titles only match a capitalised word,
 * so "Garden" (a note) isn't suggested for "the garden".
 */
export function findLinkSuggestions(
	text: string,
	index: Map<string, TitleEntry>,
	skip: Set<string> = new Set()
): LinkSuggestion[] {
	if (index.size === 0 || !text) return [];
	const words = [...text.matchAll(WORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, word: m[0] }));
	const excluded = excludedSpans(text);
	const isExcluded = (from: number, to: number) => excluded.some(([a, b]) => from < b && to > a);
	const found: LinkSuggestion[] = [];
	let i = 0;
	while (i < words.length) {
		let matched = 0;
		for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1 && !matched; n--) {
			// Words must be separated by spaces only ("Alpha, Beta" isn't "Alpha Beta").
			let contiguous = true;
			for (let k = i; k < i + n - 1 && contiguous; k++) {
				if (!/^[ \t]+$/.test(text.slice(words[k].end, words[k + 1].start))) contiguous = false;
			}
			if (!contiguous) continue;
			const key = words.slice(i, i + n).map((w) => w.word.toLowerCase()).join(' ');
			const entry = index.get(key);
			if (!entry || skip.has(entry.id)) continue;
			const from = words[i].start;
			const to = words[i + n - 1].end;
			const before = text[from - 1];
			if (before === '@' || before === '#' || before === '/' || isExcluded(from, to)) continue;
			if (n === 1 && !/^\p{Lu}/u.test(words[i].word)) continue;
			found.push({ from, to, id: entry.id, title: entry.title });
			matched = n;
		}
		i += matched || 1;
	}
	return found;
}

/** The link text for accepting a suggestion: `[[Title]]`, or `[[Title|text]]` when the text differs. */
export function linkFor(title: string, text: string): string {
	return text === title ? `[[${title}]]` : `[[${title}|${text}]]`;
}
