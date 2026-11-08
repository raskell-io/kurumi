/**
 * The PDF viewer (PdfViewer.svelte, mounted in the layout): which file is
 * open, at which page. Opened by clicking a PDF attachment, or a link to a
 * page of one (`[report.pdf, p. 3](blob:<id>#page=3)`).
 */

import { writable } from 'svelte/store';

export interface PdfViewerState {
	ref: string; // blob:<id>
	name: string;
	page: number;
	/** The note it was opened from, for "Add highlights to note". */
	noteId: string | null;
}

export const pdfViewer = writable<PdfViewerState | null>(null);

export function openPdf(ref: string, name: string, page = 1, noteId: string | null = null): void {
	pdfViewer.set({ ref, name, page, noteId });
}

export function closePdf(): void {
	pdfViewer.set(null);
}
