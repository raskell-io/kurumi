/**
 * Web clipper utilities.
 *
 * Generates a bookmarklet script the user can drag to their bookmarks
 * bar. When clicked on any page, it captures:
 *   - Page title
 *   - Page URL
 *   - Selected text (if any)
 *
 * and opens Kurumi with a `?clip=...` query parameter that the home
 * page picks up to auto-create a new memory.
 *
 * Also exports a handler that parses the clip parameter and creates
 * the memory.
 */

import { addMemoryObject } from '$lib/db';
import { goto } from '$app/navigation';

/**
 * Generate the bookmarklet JavaScript code for a given Kurumi base URL.
 * The result is a `javascript:...` URI the user can bookmark.
 */
export function generateBookmarklet(kurumiBaseUrl: string): string {
	// The bookmarklet captures page info and navigates to Kurumi with
	// the data encoded in the URL hash (to avoid CORS issues with
	// query params on hash-routed sites).
	const code = `
(function(){
  var t=document.title||'';
  var u=window.location.href;
  var s=window.getSelection?window.getSelection().toString():'';
  var d=encodeURIComponent(JSON.stringify({title:t,url:u,selection:s}));
  window.open('${kurumiBaseUrl}#/clip/'+d,'_blank');
})();
`.replace(/\n\s*/g, '');
	return `javascript:${code}`;
}

export interface ClipData {
	title: string;
	url: string;
	selection: string;
}

/**
 * Parse clip data from a URL-encoded JSON string (from the bookmarklet).
 */
export function parseClipData(encoded: string): ClipData | null {
	try {
		const json = decodeURIComponent(encoded);
		const data = JSON.parse(json);
		return {
			title: typeof data.title === 'string' ? data.title : '',
			url: typeof data.url === 'string' ? data.url : '',
			selection: typeof data.selection === 'string' ? data.selection : ''
		};
	} catch {
		return null;
	}
}

/**
 * Handle an incoming clip: create a memory from the captured page
 * data and navigate to it. Called by the hash router when it sees
 * a #/clip/... path.
 */
export function handleClip(encoded: string): void {
	const clip = parseClipData(encoded);
	if (!clip) return;

	const title = clip.title || 'Web clip';
	const lines: string[] = [];
	lines.push(`# ${title}`);
	lines.push('');
	lines.push(`Source: [${clip.url}](${clip.url})`);
	lines.push('');
	if (clip.selection) {
		lines.push('> ' + clip.selection.replace(/\n/g, '\n> '));
		lines.push('');
	}
	lines.push('## Notes');
	lines.push('');

	const memory = addMemoryObject(title, lines.join('\n'), null);
	goto(`/memory/${memory.id}`);
}
