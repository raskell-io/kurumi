/**
 * Move an element to the end of <body>: `<div use:portal>`.
 *
 * Popups rendered inside the sidebar can't escape it: the sidebar has a
 * `transform` (for the mobile slide-in), which makes it the containing
 * block and stacking context for every `position: fixed` descendant. A
 * menu that pokes past the sidebar edge is then painted *under* the main
 * pane and clicks on it land on the note instead. Portaling to <body>
 * puts the popup back in the root stacking context.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}
