/**
 * Clicking an image in the editor opens it in the full-screen viewer
 * (ImageViewer.svelte), with the note's other images one ← / → away.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { openImageFromContainer, isViewable } from '$lib/stores/imageViewer';

export const imageClickPlugin = $prose(
	() =>
		new Plugin({
			key: new PluginKey('image-click'),
			props: {
				handleClickOn(view, _pos, node, _nodePos, event, direct) {
					if (!direct || node.type.name !== 'image') return false;
					const img = event.target as HTMLElement;
					if (!(img instanceof HTMLImageElement) || !isViewable(img)) return false;
					openImageFromContainer(view.dom, img);
					return true;
				}
			}
		})
);
