import { wikilinkLabel } from '$lib/wikilinks';
import { parseCanvas } from '$lib/canvas';

/**
 * Plain-text excerpt of a note's markdown for list rows and cards: drops
 * frontmatter, formatting, tags and code; keeps link text and URLs intact.
 */
export function markdownExcerpt(content: string, maxLength = 200): string {
	// Remove markdown syntax
	let text = content
		.replace(/^---[\s\S]*?---\n?/, '') // frontmatter
		.replace(/\\([\\`*_{}[\]()#+\-.!:<>])/g, '$1') // markdown escapes
		.replace(/!\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => wikilinkLabel(inner)) // embeds: the note's name
		.replace(/^>\s?\[![a-z]+\][ \t]*/gim, '') // callout markers
		.replace(/<\/?(?:details|summary|br|div|span|p|b|i|u|mark|sup|sub|kbd)\b[^>]*>/gi, ' ') // simple HTML
		.replace(/~~([^~]+)~~/g, '$1') // strikethrough
		.replace(/==([^=]+)==/g, '$1') // highlights
		.replace(/#{1,6}\s/g, '') // headers
		.replace(/\*\*([^*]+)\*\*/g, '$1') // bold
		.replace(/\*([^*]+)\*/g, '$1') // italic
		.replace(/```[\s\S]*?```/g, '') // code blocks (before inline code, which would split them)
		.replace(/`([^`]+)`/g, '$1') // inline code
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
		.replace(/\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => wikilinkLabel(inner)) // wikilinks (their alias)
		.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1') // autolinks
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
		.replace(/^>\s/gm, '') // blockquotes
		.replace(/^[-*+]\s/gm, '') // list items
		.replace(/^\d+\.\s/gm, '') // numbered lists
		.replace(/@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g, '$1') // people
		.replace(/\/\/(\d{4}-\d{2}-\d{2})/g, '$1') // dates
		.replace(/#[a-zA-Z][a-zA-Z0-9_-]*/g, '') // tags
		.replace(/\n+/g, ' ') // newlines to spaces
		.replace(/\s+/g, ' ') // multiple spaces
		.trim();

	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength).trim() + '...';
}

/**
 * What to show for a note in a list or under a link: its summary or the
 * text without markup; a canvas by what it holds, not its JSON.
 */
export function notePreview(
	memory: { type?: string; bodyMarkdown?: string | null; summaryShort?: string | null },
	maxLength = 200
): string {
	if (memory.type === 'canvas') {
		const cards = parseCanvas(memory.bodyMarkdown).nodes.length;
		return cards === 0 ? 'Canvas, empty' : `Canvas · ${cards} ${cards === 1 ? 'card' : 'cards'}`;
	}
	return markdownExcerpt(memory.summaryShort || memory.bodyMarkdown || '', maxLength);
}
