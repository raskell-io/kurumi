/**
 * Editor → storage markdown.
 *
 * Milkdown serializes through remark-stringify, which escapes characters
 * that could start markdown syntax in plain text. Kurumi's own syntax lives
 * in plain text nodes, so a hand-typed `[[Note]]` is stored as `\[\[Note]]`
 * and a bare URL as `https\://…` — invisible in the editor, but it breaks
 * backlinks, search excerpts, exports and git sync, which all read the
 * stored markdown. This undoes exactly those escapes, leaving code spans and
 * fenced code blocks (where a backslash is the user's own text) untouched.
 */
import { codeBlockToFrontmatter } from './frontmatter';

const FENCE = /^(`{3,}|~{3,})/;

function unescapeProse(text: string): string {
	return (
		text
			// \[\[Title]] / \[\[Title\]\] -> [[Title]]
			.replace(/\\\[\\\[([^\]\n]+?)\\?\]\\?\]/g, '[[$1]]')
			// https\://example.com -> https://example.com
			.replace(/\b([a-zA-Z][a-zA-Z0-9+.-]*)\\:\/\//g, '$1://')
			// > \[!info] -> > [!info] (callout markers)
			.replace(/\\\[!(\w+)\\?\]/g, '[!$1]')
	);
}

/** Unescape outside inline code spans on a single line. */
function unescapeLine(line: string): string {
	let out = '';
	let i = 0;
	while (i < line.length) {
		const tick = line.indexOf('`', i);
		if (tick === -1) {
			out += unescapeProse(line.slice(i));
			break;
		}
		out += unescapeProse(line.slice(i, tick));
		// Match a code span opened by a run of N backticks with the next run of N.
		let run = 1;
		while (line[tick + run] === '`') run++;
		const fence = '`'.repeat(run);
		const close = line.indexOf(fence, tick + run);
		if (close === -1) {
			out += line.slice(tick);
			break;
		}
		out += line.slice(tick, close + run);
		i = close + run;
	}
	return out;
}

export function unescapeKurumiSyntax(markdown: string): string {
	const lines = markdown.split('\n');
	let openFence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const fence = lines[i].trimStart().match(FENCE)?.[1];
		if (openFence) {
			if (fence && fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
			continue;
		}
		if (fence) {
			openFence = fence;
			continue;
		}
		lines[i] = unescapeLine(lines[i]);
		// Empty table cells hold an empty paragraph, which Milkdown writes as
		// `<br />` (its preserve-empty-line feature). Blank them, keeping
		// the column alignment.
		if (/^\s*\|.*\|\s*$/.test(lines[i])) {
			lines[i] = lines[i].replace(/(\|\s*)<br \/>(?=\s*\|)/g, '$1      ');
		}
	}
	return lines.join('\n');
}

/** Full conversion from the editor's serialized markdown to what we store. */
export function toStorageMarkdown(markdown: string): string {
	return unescapeKurumiSyntax(codeBlockToFrontmatter(markdown));
}
