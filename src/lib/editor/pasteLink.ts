/**
 * Pasting a URL while text is selected turns the selection into a link
 * (Notion / Obsidian / Google Docs behaviour) instead of replacing it.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

const URL_ONLY = /^(https?:\/\/|mailto:)[^\s]+$/i;

export const pasteLinkPlugin = $prose(
	() =>
		new Plugin({
			key: new PluginKey('paste-link'),
			props: {
				handlePaste(view, event) {
					const { state } = view;
					const { from, to, empty, $from, $to } = state.selection;
					if (empty || !$from.sameParent($to) || $from.parent.type.name === 'code_block') return false;
					const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
					if (!URL_ONLY.test(text)) return false;
					const link = state.schema.marks.link;
					if (!link) return false;
					view.dispatch(state.tr.addMark(from, to, link.create({ href: text })).scrollIntoView());
					return true;
				}
			}
		})
);
