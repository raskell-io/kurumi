/**
 * Syntax highlighting for code blocks, shared by the editor (decorations,
 * `editor/codeHighlight.ts`) and the reader (`MarkdownRenderer`).
 *
 * lowlight (highlight.js grammars, ~40 common languages) is loaded on first
 * use, so notes without code don't pay for it. Tokens come back as ranges of
 * the source text, which works for both: the editor decorates the text in
 * place, the reader wraps it in spans.
 */

type Lowlight = ReturnType<typeof import('lowlight').createLowlight>;

export interface Token {
	from: number;
	to: number;
	/** highlight.js classes, e.g. `hljs-keyword` */
	className: string;
}

let lowlight: Lowlight | null = null;
let loading: Promise<Lowlight> | null = null;

/** Loaded synchronously usable instance, or null until `loadHighlighter` resolves. */
export function highlighterIfLoaded(): Lowlight | null {
	return lowlight;
}

export function loadHighlighter(): Promise<Lowlight> {
	if (lowlight) return Promise.resolve(lowlight);
	loading ??= import('lowlight').then(({ createLowlight, common }) => {
		lowlight = createLowlight(common);
		return lowlight;
	});
	return loading;
}

/** Languages that are never highlighted: rendered by something else, or prose. */
const SKIP = new Set(['', 'mermaid', 'kurumi', 'database', 'text', 'plain', 'plaintext', 'txt', 'math']);

export function normalizeLanguage(language: string | null | undefined): string {
	return String(language ?? '').trim().toLowerCase().split(/[\s{]/)[0];
}

/** Whether `language` names something the highlighter knows (aliases included). */
export function canHighlight(ll: Lowlight, language: string): boolean {
	const lang = normalizeLanguage(language);
	return !SKIP.has(lang) && ll.registered(lang);
}

interface HastNode {
	type: string;
	value?: string;
	properties?: { className?: string[] };
	children?: HastNode[];
}

/** Token ranges for `code` in `language`; empty when the language is unknown. */
export function tokenize(ll: Lowlight, code: string, language: string): Token[] {
	const lang = normalizeLanguage(language);
	if (!canHighlight(ll, lang) || code.length > 200_000) return [];
	let tree: HastNode;
	try {
		tree = ll.highlight(lang, code) as unknown as HastNode;
	} catch {
		return [];
	}
	const tokens: Token[] = [];
	let offset = 0;
	const walk = (node: HastNode, classes: string[]) => {
		if (node.type === 'text') {
			const length = node.value?.length ?? 0;
			if (classes.length && length) tokens.push({ from: offset, to: offset + length, className: classes.join(' ') });
			offset += length;
			return;
		}
		const own = node.properties?.className ?? [];
		for (const child of node.children ?? []) walk(child, own.length ? [...classes, ...own] : classes);
	};
	walk(tree, []);
	return tokens;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `code` as HTML with highlight spans (escaped), or null when the language is unknown. */
export function highlightToHtml(ll: Lowlight, code: string, language: string): string | null {
	const tokens = tokenize(ll, code, language);
	if (!tokens.length) return null;
	let html = '';
	let at = 0;
	for (const token of tokens) {
		if (token.from > at) html += escapeHtml(code.slice(at, token.from));
		html += `<span class="${token.className}">${escapeHtml(code.slice(token.from, token.to))}</span>`;
		at = token.to;
	}
	return html + escapeHtml(code.slice(at));
}

/** Languages for the editor's language picker: common names first, then the rest. */
export const COMMON_LANGUAGES = [
	'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'csharp', 'ruby', 'php',
	'swift', 'kotlin', 'bash', 'shell', 'sql', 'json', 'yaml', 'xml', 'css', 'scss', 'markdown',
	'diff', 'ini', 'makefile', 'lua', 'perl', 'r', 'graphql', 'wasm'
];
