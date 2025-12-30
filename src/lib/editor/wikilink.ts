import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

const wikilinkPluginKey = new PluginKey('wikilink');
const wikilinkRegex = /\[\[([^\]]+)\]\]/g;

export interface WikilinkClickHandler {
	(title: string): void;
}

let clickHandler: WikilinkClickHandler | null = null;

export function setWikilinkClickHandler(handler: WikilinkClickHandler) {
	clickHandler = handler;
}

function findWikilinks(doc: any): Decoration[] {
	const decorations: Decoration[] = [];

	doc.descendants((node: any, pos: number) => {
		if (node.isText && node.text) {
			let match;
			while ((match = wikilinkRegex.exec(node.text)) !== null) {
				const start = pos + match.index;
				const end = start + match[0].length;
				const title = match[1];

				decorations.push(
					Decoration.inline(start, end, {
						class: 'wikilink',
						'data-wikilink-title': title
					})
				);
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
				return DecorationSet.create(state.doc, findWikilinks(state.doc));
			},
			apply(tr, oldSet) {
				if (tr.docChanged) {
					return DecorationSet.create(tr.doc, findWikilinks(tr.doc));
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
				if (target.classList.contains('wikilink')) {
					const title = target.dataset.wikilinkTitle;
					if (title && clickHandler) {
						event.preventDefault();
						clickHandler(title);
						return true;
					}
				}
				return false;
			}
		}
	});
});
