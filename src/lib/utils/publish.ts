/**
 * Publish a memory as a standalone HTML page.
 *
 * Generates a self-contained HTML file with inline CSS that renders
 * the memory's markdown content. The user downloads it and can host
 * it anywhere (Cloudflare Pages, Netlify, any static host, or just
 * open locally in a browser).
 *
 * No external dependencies — the HTML file is fully self-contained.
 */

import { marked } from 'marked';
import type { MemoryObject } from '$lib/db/types';

export function publishMemoryAsHtml(memory: MemoryObject): void {
	const title = memory.title || 'Untitled';
	const body = marked.parse(memory.bodyMarkdown || '', {
		gfm: true,
		breaks: true
	}) as string;

	const date = new Date(memory.createdAt).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg: #1e1e2e;
  --bg-secondary: #2a2a3e;
  --text: #e0e0e8;
  --text-muted: #8888a0;
  --accent: #818cf8;
  --border: #3a3a50;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --bg-secondary: #f8f8fa;
    --text: #1a1a2e;
    --text-muted: #6b6b80;
    --accent: #6366f1;
    --border: #e0e0e8;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.8;
  padding: 2rem 1.5rem 4rem;
  max-width: 720px;
  margin: 0 auto;
}
h1 { font-size: 2.25rem; font-weight: 700; margin-bottom: 0.5rem; }
h2 { font-size: 1.5rem; font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; }
h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1em; margin-bottom: 0.4em; }
p { margin-bottom: 1em; }
a { color: var(--accent); }
code { background: var(--bg-secondary); padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875em; }
pre { background: var(--bg-secondary); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1em 0; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--accent); padding-left: 1rem; color: var(--text-muted); margin: 1em 0; }
ul, ol { margin: 0.5em 0 1em 1.5em; }
li { margin-bottom: 0.25em; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
img { max-width: 100%; border-radius: 0.5rem; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
th { background: var(--bg-secondary); font-weight: 600; }
.meta { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 2rem; }
.footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--text-muted); text-align: center; }
</style>
</head>
<body>
<article>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(date)}${memory.tags.length > 0 ? ' · ' + memory.tags.map(t => '#' + t).join(' ') : ''}</div>
${body}
</article>
<div class="footer">Published from Kurumi</div>
</body>
</html>`;

	// Trigger download
	const blob = new Blob([html], { type: 'text/html' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${slugify(title)}.html`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Copy the published HTML to clipboard so the user can paste it
 * into an email, CMS, or save it manually.
 */
export async function copyMemoryAsHtml(memory: MemoryObject): Promise<boolean> {
	const title = memory.title || 'Untitled';
	const body = marked.parse(memory.bodyMarkdown || '', {
		gfm: true,
		breaks: true
	}) as string;

	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				'text/html': new Blob([body], { type: 'text/html' }),
				'text/plain': new Blob([memory.bodyMarkdown || ''], { type: 'text/plain' })
			})
		]);
		return true;
	} catch {
		// Fallback: copy as plain markdown
		try {
			await navigator.clipboard.writeText(memory.bodyMarkdown || '');
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Use the Web Share API to share a note (title + text). Falls back
 * to copying the markdown to clipboard if share is unavailable.
 */
export async function shareMemory(memory: MemoryObject): Promise<boolean> {
	const title = memory.title || 'Untitled';
	const text = memory.bodyMarkdown || '';

	if (navigator.share) {
		try {
			await navigator.share({ title, text });
			return true;
		} catch {
			// User cancelled or API error — fall through to clipboard
		}
	}

	// Fallback: copy to clipboard
	try {
		await navigator.clipboard.writeText(`# ${title}\n\n${text}`);
		return true;
	} catch {
		return false;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '') || 'note';
}
