/**
 * The frontmatter of a linked note. The folder's own tools own it, so it is
 * kept byte for byte: `splitFrontmatter` cuts the text in two without
 * changing either part, `joinNote` puts them back, and nothing here ever
 * re-serialises YAML. `readFrontmatterFields` reads values for display and
 * for the vault's conventions (key, title, tags); it is not a YAML parser
 * and what it can't read it leaves out.
 */

export interface SplitNote {
	/**
	 * Everything before the body, exactly as in the file: a BOM if there is
	 * one, and the `---` block with both delimiters and the line end after
	 * the closing one. '' when the file has neither.
	 */
	raw: string;
	body: string;
	/** The file's line ending (that of its first line). */
	eol: '\n' | '\r\n';
}

const BOM = '\uFEFF';

export function splitFrontmatter(text: string): SplitNote {
	const firstBreak = text.indexOf('\n');
	const eol = firstBreak > 0 && text[firstBreak - 1] === '\r' ? '\r\n' : '\n';
	const start = text.startsWith(BOM) ? BOM.length : 0;
	const none: SplitNote = { raw: text.slice(0, start), body: text.slice(start), eol };
	const lineEnd = (at: number) => {
		const next = text.indexOf('\n', at);
		return next === -1 ? text.length : next + 1;
	};
	const delimiter = (at: number, end: number) => /^---[ \t]*\r?\n?$/.test(text.slice(at, end));
	// The first line is exactly `---`; the next line that is closes the block.
	let end = lineEnd(start);
	if (!delimiter(start, end) || text[end - 1] !== '\n') return none;
	for (let at = end; at < text.length; at = end) {
		end = lineEnd(at);
		if (delimiter(at, end)) return { raw: text.slice(0, end), body: text.slice(end), eol };
	}
	return none;
}

/** The file again: exactly `raw` followed by `body`. */
export function joinNote(raw: string, body: string): string {
	return raw + body;
}

function scalar(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
		return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
	}
	if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
	// An unquoted value ends at a ` #` comment.
	return v.replace(/\s+#.*$/, '').trim();
}

function inlineList(value: string): string[] {
	const items: string[] = [];
	let current = '';
	let quote = '';
	for (const ch of value) {
		if (quote) {
			current += ch;
			if (ch === quote) quote = '';
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
		} else if (ch === ',') {
			items.push(current);
			current = '';
		} else current += ch;
	}
	items.push(current);
	return items.map(scalar).filter(Boolean);
}

/**
 * The top-level fields of a frontmatter block that are a single-line value
 * (`id: project.foo`), an inline list (`tags: [a, b]`) or a list of plain
 * items below the key. Nested maps and multi-line text are left out.
 */
export function readFrontmatterFields(raw: string): Record<string, string | string[]> {
	const fields: Record<string, string | string[]> = {};
	const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
	if (!/^---[ \t]*$/.test(lines[0] ?? '')) return fields;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^---[ \t]*$/.test(line)) break;
		const match = /^([A-Za-z0-9_][\w .-]*?)\s*:(?:\s+(.*))?$/.exec(line);
		if (!match) continue;
		const key = match[1];
		const value = (match[2] ?? '').trim();
		if (value.startsWith('[') && value.endsWith(']')) {
			fields[key] = inlineList(value.slice(1, -1));
		} else if (!value || value.startsWith('#')) {
			// A list below the key; anything else nested is skipped.
			const items: string[] = [];
			let j = i + 1;
			for (; j < lines.length; j++) {
				const item = /^\s*-\s+(.*)$/.exec(lines[j]);
				if (!item) break;
				items.push(scalar(item[1]));
			}
			if (items.length) fields[key] = items.filter(Boolean);
			i = j - 1;
		} else if (/^[|>][+-]?\d*$/.test(value) || /^[{&*!]/.test(value)) {
			// Block text, a map, an anchor or a tag: not a plain value.
			continue;
		} else {
			fields[key] = scalar(value);
		}
	}
	return fields;
}
