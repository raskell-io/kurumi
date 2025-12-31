/**
 * Trailing Paragraph Plugin for Milkdown
 *
 * Ensures there's always a paragraph at the end of the document after block elements
 * like codeblocks, so users can navigate out of them with Arrow Down or click below.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const trailingParagraphKey = new PluginKey('trailing-paragraph');

/**
 * Check if the last node in the document is a block that needs a trailing paragraph
 */
function needsTrailingParagraph(doc: any): boolean {
	const lastChild = doc.lastChild;
	if (!lastChild) return false;

	// Block types that should have a trailing paragraph
	const blockTypes = ['code_block', 'fence', 'blockquote', 'table', 'horizontal_rule'];

	return blockTypes.includes(lastChild.type.name);
}

/**
 * Creates the trailing paragraph plugin
 */
export const trailingPlugin = $prose(() => {
	return new Plugin({
		key: trailingParagraphKey,
		appendTransaction(transactions, _oldState, newState) {
			// Only act if there was a document change
			const docChanged = transactions.some((tr) => tr.docChanged);
			if (!docChanged) return null;

			const { doc, schema, tr } = newState;

			if (needsTrailingParagraph(doc)) {
				// Create a new paragraph node
				const paragraphType = schema.nodes.paragraph;
				if (paragraphType) {
					const paragraph = paragraphType.create();
					// Insert at the end of the document
					return tr.insert(doc.content.size, paragraph);
				}
			}

			return null;
		}
	});
});
