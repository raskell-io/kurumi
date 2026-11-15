/**
 * Saving an edited linked note without rewriting it.
 *
 * The editor re-serialises the whole note: it re-aligns tables, escapes
 * `_` and `[`, turns `*` bullets into `-`, drops extra blank lines. Writing
 * that back would change lines the user never touched. So the editor's
 * serialisation of the untouched note is kept (`normalized`), and a save
 * takes only what differs between it and the edited serialisation and
 * applies that to the original text. Lines the user didn't change keep
 * their original bytes; an untouched note comes back byte for byte.
 *
 * An edited line is written the editor's way (a table row comes back
 * padded, a line with `_` escaped), and so is a block the editor restructures
 * (an indented code block it turns into a fenced one) when the edit is in
 * it. Pure.
 */

export interface EditBase {
	/** The note body as it is in the file (what the editor was given). */
	original: string;
	/** The editor's serialisation of it, before any edit. */
	normalized: string;
}

// Above this many line pairs the comparison would stall typing.
const MAX_CELLS = 4_000_000;

/** For each line of `a`, the line of `b` it matches (or -1): longest common subsequence. */
function matchLines(a: string[], b: string[]): Int32Array | null {
	const out = new Int32Array(a.length).fill(-1);
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		out[start] = start;
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
		out[endA] = endB;
	}
	const n = endA - start;
	const m = endB - start;
	if (n === 0 || m === 0) return out;
	if (n * m > MAX_CELLS) return null;
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] =
				a[start + i] === b[start + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[start + i] === b[start + j]) {
			out[start + i] = start + j;
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
		else j++;
	}
	return out;
}

/**
 * A line without what the editor rewrites: escapes, spacing, the padding of
 * table rules, the bullet and fence characters. A file's line and the editor's version
 * of it have the same key, so they line up even though their text differs.
 */
const key = (line: string) => line.replace(/\\/g, '').replace(/-{2,}/g, '-').replace(/\s+/g, '').replace(/^[*+]/, '-').replace(/^~{3,}/, '```');

const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i]);
const core = (text: string) => text.replace(/^\n+/, '').replace(/\n+$/, '');

/** The text to save: `base.original` with the user's changes (`edited` against `base.normalized`) applied. */
export function writeBack(base: EditBase, edited: string): string {
	if (edited === base.normalized) return base.original;
	// A file with Windows line ends keeps them; the editor only knows \n.
	const crlf = base.original.includes('\r\n') && !/(^|[^\r])\n/.test(base.original);
	const original = crlf ? base.original.replace(/\r\n/g, '\n') : base.original;
	// Blank lines at either end are the file's own (the editor drops them).
	const lead = /^\n*/.exec(original)![0];
	const middle = core(original);
	const trail = middle ? /\n*$/.exec(original)![0] : '';
	const merged = mergeLines(middle.split('\n'), core(base.normalized).split('\n'), core(edited).split('\n'));
	const out = merged ? lead + merged + trail : lead;
	return crlf ? out.replace(/\n/g, '\r\n') : out;
}

function mergeLines(original: string[], normalized: string[], edited: string[]): string {
	if (same(edited, normalized)) return original.join('\n');
	const toOriginal = matchLines(normalized.map(key), original.map(key));
	const toEdited = matchLines(normalized, edited);
	// Too large to compare: the edit wins, written the editor's way.
	if (!toOriginal || !toEdited) return edited.join('\n');
	const out: string[] = [];
	let n = 0;
	let o = 0;
	let e = 0;
	// From one line that is the same in all three to the next.
	for (let i = 0; i <= normalized.length; i++) {
		const end = i === normalized.length;
		if (!end && (toOriginal[i] < 0 || toEdited[i] < 0)) continue;
		const oEnd = end ? original.length : toOriginal[i];
		const eEnd = end ? edited.length : toEdited[i];
		const was = normalized.slice(n, i);
		const now = edited.slice(e, eEnd);
		// Untouched: the file's own lines. Edited: the edit, as the editor
		// writes it.
		out.push(...(same(now, was) ? original.slice(o, oEnd) : now));
		if (!end) out.push(original[oEnd]);
		n = i + 1;
		o = oEnd + 1;
		e = eEnd + 1;
	}
	return out.join('\n');
}
