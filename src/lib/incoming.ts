/**
 * Turns content arriving from outside the app into notes: files and
 * text from the share sheet, and markdown files opened with Kurumi.
 */

import { addMemoryObject, addMeetingMemo, transcribeMemoryAudio, updateMemoryObject } from '$lib/db';
import { storeBlob } from '$lib/db/blob-store';
import { parseMarkdownFile } from '$lib/git/convert';
import { processAndStoreImage } from '$lib/utils/image';

const isRecording = (f: File) => f.type.startsWith('audio/') || f.type.startsWith('video/');
const isImage = (f: File) => f.type.startsWith('image/');
const isText = (f: File) => /\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain';

/** An audio or video file becomes a recording memo and is transcribed. Returns the memo id. */
export async function importRecording(file: File): Promise<string> {
	const mimeType = file.type || 'audio/webm';
	const ref = await storeBlob(file, mimeType);
	const now = Date.now();
	const memory = addMeetingMemo({
		title: file.name.replace(/\.[^.]+$/, '') || 'Uploaded recording',
		rawAudioRef: ref,
		captureMode: 'upload',
		startedAt: now,
		endedAt: now
	});
	void transcribeMemoryAudio(memory.id, file, mimeType);
	return memory.id;
}

/** A markdown or text file becomes a note (front matter title and tags kept). Returns the note id. */
export async function importMarkdownFile(file: File): Promise<string> {
	const name = /\.(md|markdown)$/i.test(file.name) ? file.name.replace(/\.markdown$/i, '.md') : `${file.name.replace(/\.[^.]+$/, '')}.md`;
	const parsed = parseMarkdownFile(name, await file.text());
	const memory = addMemoryObject(parsed.title, parsed.content, null);
	if (parsed.tags.length) updateMemoryObject(memory.id, { tags: parsed.tags });
	return memory.id;
}

export interface Shared {
	title?: string;
	text?: string;
	url?: string;
	files?: File[];
}

/**
 * Everything shared at once: recordings become memos, text files notes,
 * and the shared text, link and images one note together. Returns the
 * ids created, the one to open first.
 */
export async function importShared({ title = '', text = '', url = '', files = [] }: Shared): Promise<string[]> {
	const ids: string[] = [];
	const images: string[] = [];
	for (const file of files) {
		try {
			if (isRecording(file)) ids.push(await importRecording(file));
			else if (isImage(file)) {
				const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
				images.push((await processAndStoreImage(file, alt)).markdown);
			} else if (isText(file)) ids.push(await importMarkdownFile(file));
		} catch (err) {
			console.error('Could not import shared file', file.name, err);
		}
	}

	// Some apps put the link in the text instead of the url field.
	const link = url || (/^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : '');
	const body = text.trim() === link ? '' : text.trim();
	if (title || body || link || images.length) {
		const lines: string[] = [];
		if (link) lines.push(`Source: [${link}](${link})`, '');
		if (body) lines.push(body, '');
		if (images.length) lines.push(images.join('\n\n'), '');
		const noteTitle = title.trim() || body.split('\n')[0].slice(0, 80) || (images.length ? 'Shared image' : 'Shared link');
		ids.unshift(addMemoryObject(noteTitle, lines.join('\n').trim(), null).id);
	}
	return ids;
}
