/**
 * Clickable checkboxes for GFM task items. Milkdown renders `- [ ] text`
 * as <li data-item-type="task" data-checked="false">; the checkbox itself
 * is drawn in CSS (Editor.svelte), so clicks in that left gutter toggle
 * the item's `checked` attribute here.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

// Width of the clickable checkbox area at the start of a task item, in em.
const BOX_EM = 1.6;

export const taskTogglePlugin = $prose(
	() =>
		new Plugin({
			key: new PluginKey('task-toggle'),
			props: {
				handleDOMEvents: {
					mousedown(view, event) {
						const li = (event.target as HTMLElement | null)?.closest?.('li[data-item-type="task"]');
						if (!li || !view.dom.contains(li)) return false;
						const rect = li.getBoundingClientRect();
						const em = parseFloat(getComputedStyle(li).fontSize) || 16;
						if (event.clientX > rect.left + BOX_EM * em) return false;

						const $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
						for (let d = $pos.depth; d > 0; d--) {
							const node = $pos.node(d);
							if (node.type.name !== 'list_item') continue;
							event.preventDefault();
							view.dispatch(
								view.state.tr.setNodeMarkup($pos.before(d), undefined, {
									...node.attrs,
									checked: !node.attrs.checked
								})
							);
							return true;
						}
						return false;
					}
				}
			}
		})
);
