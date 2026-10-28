/**
 * Keep formatting when pasting from other apps.
 *
 * - HTML with real structure (copying rendered output from ChatGPT, a web
 *   page, Google Docs): cleaned, converted to markdown, and inserted
 *   through the editor's own markdown parser, so tables, code languages,
 *   task lists etc. come out the same as typed markdown. Pasted straight
 *   into ProseMirror, tables broke and code blocks picked up the chat
 *   UI's "python / Copy code" header text.
 * - HTML without structure (editors put styled spans of the *source* on
 *   the clipboard): the plain-text markdown is used. Code copied from VS
 *   Code still becomes a code block (Milkdown), unless it's a markdown file.
 * - HTML copied from Kurumi itself, and plain text only: left to the
 *   default handling, which already round-trips correctly.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { DOMParser as PMDOMParser, DOMSerializer } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { fromDom } from 'hast-util-from-dom';
import { toMdast } from 'hast-util-to-mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { getMarkdownParser } from './blocks';

const STRUCTURE = 'h1,h2,h3,h4,h5,h6,ul,ol,li,table,pre,code,blockquote,strong,b,em,i,a[href],img,hr';
const LANGUAGE = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/;

/** Tidy chat/web clipboard HTML before conversion. */
function cleanHtml(doc: Document): void {
	// Google Docs wraps the whole selection in <b style="font-weight:normal">.
	doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => b.replaceWith(...b.childNodes));
	// UI chrome that isn't content.
	doc.querySelectorAll('button, svg, style, script, noscript, template').forEach((el) => el.remove());

	// <li><p>text</p></li> would become a loose list (blank line per item).
	for (const li of doc.querySelectorAll('li')) {
		const kids = [...li.childNodes].filter((n) => n.nodeType !== 3 || n.textContent?.trim());
		if (kids.length === 1 && (kids[0] as Element).tagName === 'P') (kids[0] as Element).replaceWith(...kids[0].childNodes);
	}

	for (const pre of doc.querySelectorAll('pre')) {
		const code = pre.querySelector('code');
		if (!code) continue;
		// Language from the code element, its ancestors, or a header label
		// like ChatGPT's ("python" above the block).
		let lang =
			code.className.match(LANGUAGE)?.[1] ??
			pre.className.match(LANGUAGE)?.[1] ??
			code.closest('[class*="language-"]')?.className.match(LANGUAGE)?.[1];
		if (!lang) {
			const header = [...pre.children].find((el) => el !== code && !el.contains(code));
			const label = header?.textContent?.trim() ?? '';
			if (/^[\w+#.-]{1,20}$/.test(label)) lang = label.toLowerCase();
		}
		// Keep only the code: drop headers, copy buttons and wrappers.
		const clean = doc.createElement('code');
		clean.textContent = code.textContent ?? '';
		if (lang) clean.className = `language-${lang}`;
		pre.replaceChildren(clean);
	}
}

export function htmlToMarkdown(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	cleanHtml(doc);
	const mdast = toMdast(fromDom(doc.body));
	return toMarkdown(mdast, {
		extensions: [gfmToMarkdown()],
		bullet: '-',
		fences: true,
		rule: '-'
	}).trim();
}

function insertMarkdown(view: EditorView, markdown: string): boolean {
	const parse = getMarkdownParser(view);
	if (!parse || !markdown.trim()) return false;
	const { schema } = view.state;
	// Round-trip through the DOM like Milkdown's own text paste: parseSlice
	// normalises node attributes (e.g. keeps lists tight) and makes a single
	// pasted paragraph merge into the current line.
	const dom = DOMSerializer.fromSchema(schema).serializeFragment(parse(markdown).content);
	const slice = PMDOMParser.fromSchema(schema).parseSlice(dom);
	view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
	return true;
}

export const pasteMarkdownPlugin = $prose(
	() =>
		new Plugin({
			key: new PluginKey('paste-markdown'),
			props: {
				handlePaste(view, event) {
					const data = event.clipboardData;
					if (!data || view.state.selection.$from.parent.type.spec.code) return false;
					// Pasted files (images) are handled by the editor's image paste.
					if ([...data.items].some((item) => item.kind === 'file')) return false;
					const html = data.getData('text/html');
					const text = data.getData('text/plain');
					// Code copied from VS Code: Milkdown makes a code block in the
					// right language. Only markdown files are pasted as markdown.
					const vscodeMode = (() => {
						try {
							return JSON.parse(data.getData('vscode-editor-data') || 'null')?.mode as string | undefined;
						} catch {
							return undefined;
						}
					})();
					if (vscodeMode && vscodeMode !== 'markdown') return false;
					if (vscodeMode === 'markdown') return insertMarkdown(view, text);
					if (!html || html.includes('data-pm-slice')) return false; // plain text / our own copy

					const probe = new DOMParser().parseFromString(html, 'text/html');
					if (probe.body.querySelector(STRUCTURE)) {
						return insertMarkdown(view, htmlToMarkdown(html));
					}
					return text ? insertMarkdown(view, text) : false;
				}
			}
		})
);
