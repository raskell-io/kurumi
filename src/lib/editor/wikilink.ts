import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { createRegistry } from './registry';
import { parseWikilink, WIKILINK_PATTERN } from '$lib/wikilinks';

const wikilinkPluginKey = new PluginKey('wikilink');

export interface WikilinkClickHandler {
	(title: string, event: MouseEvent): void;
}

// Click handlers per editor (see ./registry).
const handlers = createRegistry<WikilinkClickHandler>();

/** Register (or, with null, remove) the handler for the editor rooted at `root`. */
export function setWikilinkClickHandler(root: Element, handler: WikilinkClickHandler | null) {
	if (handler) handlers.set(root, handler);
	else handlers.delete(root);
}

/**
 * Decorate every [[link]]. In `[[Note|text]]` the `Note|` part is hidden
 * unless the cursor is in the link, so it reads `[[text]]`; clicks go to
 * Note either way (see $lib/wikilinks).
 */
function findWikilinks(doc: any, selection?: { from: number; to: number }): Decoration[] {
	const decorations: Decoration[] = [];

	doc.descendants((node: any, pos: number) => {
		if (node.isText && node.text) {
			for (const match of node.text.matchAll(WIKILINK_PATTERN) as IterableIterator<RegExpMatchArray>) {
				const start = pos + match.index!;
				const end = start + match[0].length;
				const inner = match[1];
				const { target } = parseWikilink(inner);

				decorations.push(
					Decoration.inline(start, end, {
						class: 'wikilink',
						'data-wikilink-title': target || inner
					})
				);

				const bar = inner.search(/\\?\|/);
				const editing = selection && selection.from <= end && selection.to >= start;
				if (bar > 0 && !editing) {
					const barLength = inner[bar] === '\\' ? 2 : 1;
					decorations.push(
						Decoration.inline(start + 2, start + 2 + bar + barLength, { class: 'wikilink-target-hidden' })
					);
				}
			}
		}
	});

	return decorations;
}

export const wikilinkPlugin = $prose(() => {
	return new Plugin({
		key: wikilinkPluginKey,
		state: {
			init(_, state) {
				return DecorationSet.create(state.doc, findWikilinks(state.doc, state.selection));
			},
			apply(tr, oldSet, _old, state) {
				// The selection decides which aliases show their target.
				if (tr.docChanged || tr.selectionSet) {
					return DecorationSet.create(tr.doc, findWikilinks(tr.doc, state.selection));
				}
				return oldSet.map(tr.mapping, tr.doc);
			}
		},
		props: {
			decorations(state) {
				return this.getState(state);
			},
			handleClick(view, pos, event) {
				const target = event.target as HTMLElement;
				const link = target.closest<HTMLElement>('.wikilink');
				if (link) {
					const title = link.dataset.wikilinkTitle;
					const clickHandler = handlers.get(view);
					if (title && clickHandler) {
						event.preventDefault();
						clickHandler(title, event);
						return true;
					}
				}
				return false;
			}
		}
	});
});
