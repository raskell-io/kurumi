/**
 * A textarea that holds one line of text, wrapped to as many rows as it
 * needs (a note's title): `<textarea use:singleLine>`. A line break can't be
 * typed (the field's own Enter handler decides what Enter does), and pasted
 * or dropped text comes in as one line, its line breaks turned into spaces.
 */
export const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ');

export function singleLine(el: HTMLTextAreaElement) {
	const insert = (text: string) => {
		const start = el.selectionStart;
		el.setRangeText(oneLine(text), start, el.selectionEnd, 'end');
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const onBeforeInput = (e: InputEvent) => {
		if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') e.preventDefault();
	};
	const onPaste = (e: ClipboardEvent) => {
		const text = e.clipboardData?.getData('text/plain');
		if (text === undefined || !/[\r\n]/.test(text)) return;
		e.preventDefault();
		insert(text);
	};
	const onDrop = (e: DragEvent) => {
		const text = e.dataTransfer?.getData('text/plain');
		if (!text || !/[\r\n]/.test(text)) return;
		e.preventDefault();
		el.focus();
		insert(text);
	};
	el.addEventListener('beforeinput', onBeforeInput);
	el.addEventListener('paste', onPaste);
	el.addEventListener('drop', onDrop);
	return {
		destroy() {
			el.removeEventListener('beforeinput', onBeforeInput);
			el.removeEventListener('paste', onPaste);
			el.removeEventListener('drop', onDrop);
		}
	};
}
