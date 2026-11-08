/**
 * Code blocks in the editor: syntax highlighting (decorations from
 * `$lib/highlight`, lowlight loaded on first code block) and a header with a
 * language picker and a copy button.
 *
 * The node view is created by mermaid.ts, which owns the code_block node view
 * (only one plugin can); this plugin only adds the decorations.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import {
	COMMON_LANGUAGES,
	highlighterIfLoaded,
	loadHighlighter,
	normalizeLanguage,
	tokenize,
	type Token
} from '$lib/highlight';

const key = new PluginKey<DecorationSet>('kurumi-code-highlight');

export const isFrontmatterBlock = (node: ProseMirrorNode) =>
	String(node.attrs.language ?? '').trim() === 'yaml:frontmatter';

// Tokens by language + text: typing in one block doesn't re-highlight the others.
const cache = new Map<string, Token[]>();
function tokensFor(language: string, text: string): Token[] {
	const ll = highlighterIfLoaded();
	if (!ll) return [];
	const cacheKey = `${language}\u0000${text}`;
	let tokens = cache.get(cacheKey);
	if (!tokens) {
		tokens = tokenize(ll, text, language);
		cache.set(cacheKey, tokens);
		if (cache.size > 300) cache.delete(cache.keys().next().value!);
	}
	return tokens;
}

function decorate(doc: ProseMirrorNode): { set: DecorationSet; wantsHighlighter: boolean } {
	const decorations: Decoration[] = [];
	let wantsHighlighter = false;
	doc.descendants((node, pos) => {
		if (node.type.name !== 'code_block') return true;
		const language = normalizeLanguage(node.attrs.language);
		if (!language || isFrontmatterBlock(node)) return false;
		if (!highlighterIfLoaded()) {
			wantsHighlighter = true;
			return false;
		}
		for (const token of tokensFor(language, node.textContent)) {
			decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }));
		}
		return false;
	});
	return { set: DecorationSet.create(doc, decorations), wantsHighlighter };
}

export const codeHighlightPlugin = $prose(
	() =>
		new Plugin<DecorationSet>({
			key,
			state: {
				init: (_, state) => decorate(state.doc).set,
				apply(tr, old) {
					if (!tr.docChanged && !tr.getMeta(key)) return old.map(tr.mapping, tr.doc);
					return decorate(tr.doc).set;
				}
			},
			view(view) {
				// Load the highlighter once a note has a code block with a language.
				const check = (v: EditorView) => {
					if (highlighterIfLoaded() || !decorate(v.state.doc).wantsHighlighter) return;
					loadHighlighter().then(() => {
						if (!(v as EditorView & { isDestroyed?: boolean }).isDestroyed) v.dispatch(v.state.tr.setMeta(key, true));
					});
				};
				check(view);
				return { update: check };
			},
			props: {
				decorations: (state) => key.getState(state)
			}
		})
);

let datalist: HTMLDataListElement | null = null;
function languageList(): string {
	if (!datalist) {
		datalist = document.createElement('datalist');
		datalist.id = 'kurumi-code-languages';
		for (const lang of [...COMMON_LANGUAGES, 'mermaid', 'text']) {
			const option = document.createElement('option');
			option.value = lang;
			datalist.appendChild(option);
		}
		document.body.appendChild(datalist);
	}
	return datalist.id;
}

/** Node view for an ordinary code block: header (language, copy) + the code. */
export function codeBlockView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
	const dom = document.createElement('div');
	dom.className = 'kurumi-code';
	const header = document.createElement('div');
	header.className = 'kurumi-code-header';
	header.contentEditable = 'false';

	const language = document.createElement('input');
	language.className = 'kurumi-code-lang';
	language.setAttribute('list', languageList());
	language.placeholder = 'language';
	language.spellcheck = false;
	language.setAttribute('aria-label', 'Code language');
	language.value = node.attrs.language ?? '';
	const fit = () => (language.size = Math.max(language.value.length + 3, 8));
	fit();
	language.addEventListener('input', fit);

	const copy = document.createElement('button');
	copy.type = 'button';
	copy.className = 'kurumi-code-copy';
	copy.textContent = 'Copy';
	copy.title = 'Copy code';
	header.append(language, copy);

	const pre = document.createElement('pre');
	const code = document.createElement('code');
	pre.appendChild(code);
	const setLanguageAttr = (lang: string) => {
		if (lang) pre.dataset.language = lang;
		else delete pre.dataset.language;
	};
	setLanguageAttr(node.attrs.language ?? '');
	dom.append(header, pre);

	let current = node;
	const commitLanguage = () => {
		const pos = getPos();
		const value = language.value.trim();
		if (pos === undefined || value === (current.attrs.language ?? '')) return;
		view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: value }));
	};
	language.addEventListener('change', commitLanguage);
	language.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === 'Escape') {
			event.preventDefault();
			if (event.key === 'Escape') language.value = current.attrs.language ?? '';
			else commitLanguage();
			view.focus();
		}
	});
	copy.addEventListener('click', () => {
		navigator.clipboard?.writeText(current.textContent).then(() => {
			copy.textContent = 'Copied';
			setTimeout(() => (copy.textContent = 'Copy'), 1500);
		});
	});

	return {
		dom,
		contentDOM: code,
		update(next: ProseMirrorNode) {
			if (next.type !== current.type) return false;
			const lang = normalizeLanguage(next.attrs.language);
			// Diagrams, queries and databases have their own views.
			if (['mermaid', 'kurumi', 'database'].includes(lang) || isFrontmatterBlock(next)) return false;
			current = next;
			if (document.activeElement !== language) {
				language.value = next.attrs.language ?? '';
				fit();
			}
			setLanguageAttr(next.attrs.language ?? '');
			return true;
		},
		ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
			return header.contains(mutation.target);
		},
		stopEvent(event: Event) {
			return header.contains(event.target as Node);
		}
	};
}
