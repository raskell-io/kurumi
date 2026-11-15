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

// ---- Editing one field ------------------------------------------------------

interface ScalarLine {
	/** Offsets of the value in `raw` (inside the quotes, if quoted). */
	start: number;
	end: number;
	quote: '' | '"' | "'";
	value: string;
}

/** The line `key: value` of the block, if its value is one plain or simply quoted scalar. */
function scalarLine(raw: string, key: string): ScalarLine | null {
	if (!/^\uFEFF?---[ \t]*\r?\n/.test(raw)) return null;
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// At the start of a line: a nested key (indented) is another field.
	const line = new RegExp(`(^|\\n)(${escaped}[ \\t]*:[ \\t]+)([^\\r\\n]*?)([ \\t]*)(?=\\r?\\n)`).exec(raw);
	if (!line) return null;
	const text = line[3];
	const start = line.index + line[1].length + line[2].length;
	if (!text) return null; // nothing, or a block that starts on the next line
	if (text[0] === '"') {
		// Escapes would need a YAML writer to keep them right.
		if (text.length < 2 || !text.endsWith('"') || /["\\]/.test(text.slice(1, -1))) return null;
		return { start: start + 1, end: start + text.length - 1, quote: '"', value: text.slice(1, -1) };
	}
	if (text[0] === "'") {
		if (text.length < 2 || !text.endsWith("'") || text.slice(1, -1).includes("'")) return null;
		return { start: start + 1, end: start + text.length - 1, quote: "'", value: text.slice(1, -1) };
	}
	// Plain: not a list, map, block text, anchor, alias or tag, and no comment after it.
	if (/^[[{|>&*!%@`]/.test(text) || /\s#/.test(text) || /:\s/.test(text) || text.endsWith(':')) return null;
	return { start, end: start + text.length, quote: '', value: text };
}

/** A field's value if `setScalarField` could change it: a single-line scalar. Else null. */
export function scalarFieldValue(raw: string, key: string): string | null {
	return scalarLine(raw, key)?.value ?? null;
}

/**
 * `raw` with the value of the existing line `key: value` replaced, and
 * nothing else touched: the quoting style, the spacing and every other byte
 * stay. Returns `raw` unchanged when the key is missing, its value isn't a
 * single-line scalar, or `value` can't be written in the line's style
 * without escaping.
 */
export function setScalarField(raw: string, key: string, value: string): string {
	const line = scalarLine(raw, key);
	if (!line || line.value === value || /[\r\n]/.test(value)) return raw;
	if (line.quote === '"' && /["\\]/.test(value)) return raw;
	if (line.quote === "'" && value.includes("'")) return raw;
	if (!line.quote && (!value || value !== value.trim() || /^[[{|>&*!%@`'"#?-]/.test(value) || /\s#/.test(value) || /:\s/.test(value) || value.endsWith(':'))) return raw;
	return raw.slice(0, line.start) + value + raw.slice(line.end);
}
