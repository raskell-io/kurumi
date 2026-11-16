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
	return {
		update: () => fit(),
		destroy: () => el.removeEventListener('input', fit)
	};
}
