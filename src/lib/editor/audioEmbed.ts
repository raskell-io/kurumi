/**
 * Audio embed NodeView for Milkdown.
 *
 * Audio recordings are stored in markdown as image nodes with an
 * "audio:" alt prefix:  ![audio:Voice memo](blob:ref)
 *
 * Milkdown parses this as a normal image, but this plugin intercepts
 * the rendering and replaces the <img> with a real <audio controls>
 * player. Non-audio images fall through to the default rendering.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';

const audioEmbedKey = new PluginKey('audio-embed');

function resolveAudioSrc(audio: HTMLAudioElement, blobRef: string) {
	import('$lib/utils/image').then(({ resolveBlobUrl }) => {
		resolveBlobUrl(blobRef).then((url) => {
			if (url) audio.src = url;
		});
	});
}

export const audioEmbedPlugin = $prose(() => {
	return new Plugin({
		key: audioEmbedKey,
		props: {
			nodeViews: {
				image(node: ProseMirrorNode) {
					const alt = node.attrs.alt || '';
					if (!alt.startsWith('audio:')) {
						// Not an audio embed — let ProseMirror use default rendering.
						// Returning null/undefined makes ProseMirror fall back to toDOM.
						return null as never;
					}

					const src: string = node.attrs.src || '';

					const wrapper = document.createElement('div');
					wrapper.className = 'kurumi-audio-embed';
					wrapper.contentEditable = 'false';

					const audio = document.createElement('audio');
					audio.controls = true;
					audio.style.width = '100%';
					audio.style.maxWidth = '500px';
					audio.style.display = 'block';
					audio.style.margin = '0.5rem 0';

					if (src.startsWith('blob:') && !src.startsWith('blob:http')) {
						resolveAudioSrc(audio, src);
					} else if (src) {
						audio.src = src;
					}

					wrapper.appendChild(audio);

					return {
						dom: wrapper,
						update(updatedNode: ProseMirrorNode) {
							if (updatedNode.type.name !== 'image') return false;
							if (!(updatedNode.attrs.alt || '').startsWith('audio:')) return false;
							const newSrc: string = updatedNode.attrs.src || '';
							if (newSrc && newSrc !== src) {
								if (newSrc.startsWith('blob:') && !newSrc.startsWith('blob:http')) {
									resolveAudioSrc(audio, newSrc);
								} else {
									audio.src = newSrc;
								}
							}
							return true;
						},
						stopEvent() {
							return true;
						},
						ignoreMutation() {
							return true;
						}
					};
				}
			}
		}
	});
});
