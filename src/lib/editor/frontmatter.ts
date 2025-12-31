/**
 * Frontmatter Plugin for Milkdown
 *
 * Transforms YAML frontmatter to/from a code block for proper display
 * in the WYSIWYG editor. Without this, `---` delimiters render as <hr>.
 *
 * On load: ---\nkey: value\n--- → ```yaml:frontmatter\nkey: value\n```
 * On save: ```yaml:frontmatter\nkey: value\n``` → ---\nkey: value\n---
 */

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---(\n|$)/;
const CODE_BLOCK_MARKER = '```yaml:frontmatter';

/**
 * Convert frontmatter to a code block for editor display
 */
export function frontmatterToCodeBlock(content: string): string {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) return content;

	const frontmatterContent = match[1];
	const rest = content.slice(match[0].length);

	return `${CODE_BLOCK_MARKER}\n${frontmatterContent}\n\`\`\`\n${rest}`;
}

/**
 * Convert code block back to frontmatter for storage
 */
export function codeBlockToFrontmatter(content: string): string {
	// Match our special code block marker
	const codeBlockRegex = /^```yaml:frontmatter\n([\s\S]*?)\n```(\n|$)/;
	const match = content.match(codeBlockRegex);
	if (!match) return content;

	const frontmatterContent = match[1];
	const rest = content.slice(match[0].length);

	return `---\n${frontmatterContent}\n---\n${rest}`;
}

/**
 * Check if content has frontmatter
 */
export function hasFrontmatter(content: string): boolean {
	return FRONTMATTER_REGEX.test(content);
}

/**
 * Check if content has our code block marker
 */
export function hasCodeBlockFrontmatter(content: string): boolean {
	return content.startsWith(CODE_BLOCK_MARKER);
}
