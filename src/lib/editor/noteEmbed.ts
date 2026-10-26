/**
 * `![[Title]]` on a line of its own renders the target note below it
 * (Obsidian-style embed). The source line stays editable; the rendered
 * note is a read-only widget that follows edits to the embedded note.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { mount, unmount } from 'svelte';
import NoteEmbed from '$lib/components/NoteEmbed.svelte';

const embedKey = new PluginKey('note-embed');
const EMBED_LINE = /^!\[\[([^\]]+)\]\]$/;

function findEmbeds(doc: PMNode): DecorationSet {
	const decorations: Decoration[] = [];
	const seen = new Map<string, number>();
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		if (node.type.name === 'code_block') return false;
		const title = node.textContent.trim().match(EMBED_LINE)?.[1]?.trim();
		if (title) {
			const n = (seen.get(title.toLowerCase()) ?? 0) + 1;
			seen.set(title.toLowerCase(), n);
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'note-embed-source' }));
			decorations.push(
				Decoration.widget(
					pos + node.nodeSize,
					() => {
						const el = document.createElement('div');
						const component = mount(NoteEmbed, { target: el, props: { title } });
						(el as HTMLElement & { _unmount?: () => void })._unmount = () => unmount(component);
						return el;
					},
					{
						// Same title (nth occurrence) → reuse the widget across
						// edits instead of remounting it.
						key: `embed:${title.toLowerCase()}:${n}`,
						side: 1,
						ignoreSelection: true,
						stopEvent: () => true,
						destroy: (el) => (el as HTMLElement & { _unmount?: () => void })._unmount?.()
					}
				)
			);
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

export const noteEmbedPlugin = $prose(
	() =>
		new Plugin({
			key: embedKey,
			state: {
				init: (_, state) => findEmbeds(state.doc),
				apply: (tr, old) => (tr.docChanged ? findEmbeds(tr.doc) : old)
			},
			props: {
				decorations(state) {
					return embedKey.getState(state);
				}
			}
		})
);
