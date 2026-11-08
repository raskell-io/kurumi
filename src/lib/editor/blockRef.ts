/**
 * Block references in the editor. A block's id is a ` ^a1b2c3` marker at
 * the end of its text (Obsidian's syntax); the marker is shown faint and
 * carries `data-block-id`, so links to it ([[Note#^a1b2c3]]) can find it.
 * linkToBlock adds a marker if needed and returns the link.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { BLOCK_ID_PATTERN, headingKey, newBlockId } from '$lib/wikilinks';

const key = new PluginKey('block-ref');

function findMarkers(doc: PMNode): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		if (node.type.spec.code) return false;
		const text = node.textContent;
		const match = text.match(BLOCK_ID_PATTERN);
		if (match) {
			const from = pos + 1 + match.index! + 1; // after the space
			decorations.push(
				Decoration.inline(from, pos + 1 + text.trimEnd().length, { class: 'block-id', 'data-block-id': match[1] })
			);
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

export const blockRefPlugin = $prose(
	() =>
		new Plugin({
			key,
			state: {
				init: (_, state) => findMarkers(state.doc),
				apply: (tr, old) => (tr.docChanged ? findMarkers(tr.doc) : old)
			},
			props: {
				decorations(state) {
					return key.getState(state);
				}
			}
		})
);

/**
 * A link to the block at `pos` (inside it) in the note titled `title`:
 * `[[Title#Heading]]` for a heading, otherwise `[[Title#^id]]`, adding the
 * id marker to the block's last line of text if it has none.
 */
export function linkToBlock(view: EditorView, pos: number, title: string): string | null {
	const { doc } = view.state;
	const $pos = doc.resolve(Math.min(pos, doc.content.size));
	// The innermost textblock at or after pos.
	let textblock: PMNode | null = null;
	let textblockPos = -1;
	doc.nodesBetween(pos, Math.min(doc.content.size, pos + ($pos.parent.nodeSize || 1) + 2), (node, at) => {
		if (textblock) return false;
		if (node.isTextblock) {
			textblock = node;
			textblockPos = at;
			return false;
		}
		return true;
	});
	if (!textblock || textblockPos < 0) return null;
	const block = textblock as PMNode;
	if (block.type.spec.code) return null;
	if (block.type.name === 'heading') {
		const text = block.textContent.replace(BLOCK_ID_PATTERN, '').trim();
		return text && headingKey(text) ? `[[${title}#${text}]]` : null;
	}
	const existing = block.textContent.match(BLOCK_ID_PATTERN)?.[1];
	if (existing) return `[[${title}#^${existing}]]`;
	const id = newBlockId();
	const end = textblockPos + block.nodeSize - 1;
	view.dispatch(view.state.tr.insertText(` ^${id}`, end));
	return `[[${title}#^${id}]]`;
}
