/**
 * Per-editor registrations for the editor plugins' UI callbacks.
 *
 * Plugins are module singletons, but Kurumi can show two editors at once
 * (split view). Each Editor component registers its callbacks under its
 * own container element; a plugin finds the right set by walking up from
 * the view's DOM. Unregistering one editor never blanks another's.
 */
import type { EditorView } from '@milkdown/kit/prose/view';

export function createRegistry<T>() {
	const byRoot = new WeakMap<Element, T>();
	return {
		set(root: Element, value: T) {
			byRoot.set(root, value);
		},
		delete(root: Element) {
			byRoot.delete(root);
		},
		get(view: EditorView | null | undefined): T | undefined {
			for (let el: Element | null = view?.dom ?? null; el; el = el.parentElement) {
				const value = byRoot.get(el);
				if (value) return value;
			}
			return undefined;
		}
	};
}
