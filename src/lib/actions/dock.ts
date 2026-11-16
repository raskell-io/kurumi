/**
 * Show an element somewhere else in the page while there is such a place:
 * `<div use:dock={target}>`. With a target it is moved in as its last child;
 * with `null` it goes back to where it was written. Its content, handlers
 * and bindings stay the component's own.
 *
 * Used for the note's controls, which sit in the top bar on wide windows
 * (`noteBarSlot` in stores/workspace.ts) and in the note itself otherwise.
 */
export function dock(node: HTMLElement, target: HTMLElement | null) {
	const home = document.createComment('dock');
	node.before(home);
	const place = (to: HTMLElement | null) => {
		if (to) {
			if (node.parentNode !== to) to.appendChild(node);
		} else if (home.parentNode && home.nextSibling !== node) {
			home.after(node);
		}
	};
	place(target);
	return {
		update: place,
		destroy() {
			node.remove();
			home.remove();
		}
	};
}
