/**
 * Visual checkbox renderer for the Milkdown editor.
 *
 * Milkdown's GFM preset may not reliably render `[ ]` / `[x]` as
 * interactive checkboxes during live editing. This module uses a
 * MutationObserver to scan the editor's DOM after each update, find
 * text matching `[ ]` or `[x]` at the start of list items or lines,
 * and overlay styled checkbox elements on top of them.
 *
 * The approach:
 *   1. Find text nodes containing `[ ]` or `[x]` patterns
 *   2. Wrap them in a <span> with a data-checkbox attribute
 *   3. CSS hides the bracket text and shows a styled pseudo-element
 *   4. Clicking toggles between checked/unchecked states
 *
 * This is purely visual — the underlying markdown text is preserved
 * for Milkdown's serialization.
 */

const CHECKBOX_REGEX = /^(\s*[-*]\s)?\[( |x|X)\]/;
const PROCESSED_ATTR = 'data-kurumi-checkbox';

/**
 * Start observing the editor container for checkbox text and render
 * visual checkboxes. Returns a cleanup function.
 */
export function startCheckboxRenderer(container: HTMLElement): () => void {
	function processNode() {
		// Find all text nodes in the editor that contain checkbox patterns
		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_TEXT,
			null
		);

		const nodesToProcess: Array<{ node: Text; checked: boolean; offset: number; length: number }> = [];
		let textNode: Text | null;
		while ((textNode = walker.nextText() as Text | null)) {
			// Skip if already inside a processed checkbox span
			if (textNode.parentElement?.hasAttribute(PROCESSED_ATTR)) continue;

			const text = textNode.textContent || '';
			// Match [ ] or [x] at the start of the text (possibly preceded by - or * )
			const match = text.match(/\[( |x|X)\]/);
			if (!match || match.index === undefined) continue;

			const checked = match[1] === 'x' || match[1] === 'X';
			nodesToProcess.push({
				node: textNode,
				checked,
				offset: match.index,
				length: match[0].length
			});
		}

		for (const { node, checked, offset, length } of nodesToProcess) {
			try {
				// Split the text node around the checkbox pattern
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + length);

				// Check if already wrapped
				const parent = range.commonAncestorContainer.parentElement;
				if (parent?.hasAttribute(PROCESSED_ATTR)) continue;

				// Create the visual checkbox span
				const span = document.createElement('span');
				span.setAttribute(PROCESSED_ATTR, checked ? 'checked' : 'unchecked');
				span.className = `kurumi-checkbox ${checked ? 'checked' : 'unchecked'}`;
				span.contentEditable = 'false';
				span.title = checked ? 'Completed — click to uncheck' : 'Click to complete';

				// Click handler to toggle
				span.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const isChecked = span.getAttribute(PROCESSED_ATTR) === 'checked';
					const newText = isChecked ? '[ ]' : '[x]';
					span.setAttribute(PROCESSED_ATTR, isChecked ? 'unchecked' : 'checked');
					span.className = `kurumi-checkbox ${isChecked ? 'unchecked' : 'checked'}`;
					span.title = isChecked ? 'Click to complete' : 'Completed — click to uncheck';
					// Update the text content inside the span
					span.textContent = newText;
				});

				range.surroundContents(span);
			} catch {
				// Range manipulation can fail if the DOM changed mid-process
			}
		}
	}

	// Run once immediately
	requestAnimationFrame(processNode);

	// Re-run on DOM changes
	const observer = new MutationObserver(() => {
		requestAnimationFrame(processNode);
	});

	observer.observe(container, {
		childList: true,
		subtree: true,
		characterData: true
	});

	return () => observer.disconnect();
}

// Extend TreeWalker to have a nextText method for convenience
declare global {
	interface TreeWalker {
		nextText(): Text | null;
	}
}

TreeWalker.prototype.nextText = function (): Text | null {
	return this.nextNode() as Text | null;
};
