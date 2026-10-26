/**
 * Notion-style block handle: hovering a block shows `+` (add a block
 * below and open the slash menu) and `⋮⋮` (drag to move; click for the
 * block menu). Built on Milkdown's block plugin, which positions the
 * handle and implements dragging the selected node.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import { block, blockConfig, BlockProvider } from '@milkdown/kit/plugin/block';
import type { ResolvedPos } from '@milkdown/kit/prose/model';
import { insertParagraphAfter } from './blocks';

export { block };

const PLUS =
	'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5v14"/></svg>';
const GRIP =
	'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>';

/**
 * One handle per top-level block and per list item (instead of the
 * plugin default, where a list's first item stands for the whole list).
 * Returning false makes the plugin look one level up.
 */
function filterNodes($pos: ResolvedPos, node: { type: { name: string } }): boolean {
	for (let d = $pos.depth; d > 0; d--) {
		if ($pos.node(d).type.name === 'table') return false;
	}
	if (node.type.name === 'list_item') return true;
	return $pos.depth === 0;
}

export function configureBlockHandle(
	ctx: Ctx,
	onMenu: (anchor: DOMRect, blockPos: number) => void
): void {
	ctx.update(blockConfig.key, (config) => ({ ...config, filterNodes }));
	ctx.set(block.key, {
		view: () => {
			const el = document.createElement('div');
			el.className = 'kurumi-block-handle';
			el.innerHTML = `<button type="button" class="bh-btn bh-add" title="Add a block below" aria-label="Add a block below">${PLUS}</button><button type="button" class="bh-btn bh-grip" title="Drag to move · Click for options" aria-label="Block options">${GRIP}</button>`;

			const provider = new BlockProvider({
				ctx,
				content: el,
				getOffset: () => 6,
				getPlacement: () => 'left-start'
			});

			el.querySelector('.bh-add')!.addEventListener('click', (e) => {
				e.preventDefault();
				const active = provider.active;
				if (!active) return;
				const view = ctx.get(editorViewCtx);
				insertParagraphAfter(view, active.$pos.pos);
				// Open the slash menu in the new block, like Notion's `+`.
				view.dispatch(view.state.tr.insertText('/'));
			});
			el.querySelector('.bh-grip')!.addEventListener('click', (e) => {
				const active = provider.active;
				if (!active) return;
				onMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), active.$pos.pos);
			});

			return { update: provider.update, destroy: provider.destroy };
		}
	});
}
