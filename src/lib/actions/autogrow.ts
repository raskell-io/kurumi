/**
 * A textarea that grows with its text (with .k-autogrow). Browsers with
 * `field-sizing: content` do it in CSS; this covers the others (Safari, so
 * the desktop app).
 */
// `use:autogrow={value}`: the value only tells it to measure again when the text
// changes from outside (a bound value set by code).
export function autogrow(el: HTMLTextAreaElement, _value?: unknown) {
	if (CSS.supports?.('field-sizing', 'content')) return {};
	const fit = () => {
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight + 2}px`;
	};
	fit();
	el.addEventListener('input', fit);
	// A narrower or wider field wraps its text to more or fewer rows.
	let width = el.clientWidth;
	const resized = new ResizeObserver(() => {
		if (el.clientWidth === width) return;
		width = el.clientWidth;
		fit();
	});
	resized.observe(el);
	// The editor font arriving after the first measure changes the line height.
	document.fonts?.ready.then(fit).catch(() => {});
	return {
		update: () => fit(),
		destroy: () => {
			el.removeEventListener('input', fit);
			resized.disconnect();
		}
	};
}
