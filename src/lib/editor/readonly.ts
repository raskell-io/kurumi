/**
 * Read-only editors (notes of a linked folder): besides the view not being
 * editable (Editor.svelte), no transaction may change the document, so the
 * plugins that edit on a click (task checkboxes, the block menu, drops) do
 * nothing either. Selection, folding and links keep working.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createRegistry } from './registry';

// Read-only editors (see ./registry).
const readonlyEditors = createRegistry<true>();

/** Mark the editor rooted at `root` read-only (before it is created), or not. */
export function setEditorReadonly(root: Element, readonly: boolean) {
	if (readonly) readonlyEditors.set(root, true);
	else readonlyEditors.delete(root);
}

export const readonlyPlugin = $prose(() => {
	let view: EditorView | null = null;
	return new Plugin({
		key: new PluginKey('kurumi-readonly'),
		view(editorView) {
			view = editorView;
			return {};
		},
		filterTransaction: (tr) => !(tr.docChanged && view && readonlyEditors.get(view))
	});
});
