/**
 * Focus an element once it's mounted: `<input use:autofocus />`.
 *
 * The native `autofocus` attribute is unreliable for elements rendered in
 * an `{#if}` block, e.g. when the button that opened a form unmounts in the
 * same update and focus falls back to <body>. Focusing on the next frame
 * avoids that. Pass `{ select: true }` to also select an input's text.
 */
export function autofocus(node: HTMLElement, options: { select?: boolean } = {}) {
	const frame = requestAnimationFrame(() => {
		node.focus({ preventScroll: true });
		if (options.select && node instanceof HTMLInputElement) node.select();
	});
	return {
		destroy() {
			cancelAnimationFrame(frame);
		}
	};
}
