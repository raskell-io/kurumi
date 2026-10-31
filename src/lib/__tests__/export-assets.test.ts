import { describe, it, expect } from 'vitest';
import { blobRefsOf, collectAssets, linkAssets, exportMemoriesToFiles } from '../utils/markdown-export';
import type { Folder, MemoryObject, Vault } from '../db/types';

const memory = (over: Partial<MemoryObject>): MemoryObject =>
	({ id: 'm1', title: 'Note', bodyMarkdown: '', tags: [], folderId: null, vaultId: 'v', createdAt: 0, updatedAt: 0, ...over }) as MemoryObject;

const blobs: Record<string, { blob: Blob; mimeType: string }> = {
	'blob:img1': { blob: new Blob(['i']), mimeType: 'image/avif' },
	'blob:doc1': { blob: new Blob(['d']), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
	'blob:rec1': { blob: new Blob(['r']), mimeType: 'audio/webm' }
};
const read = async (ref: string) => blobs[ref] ?? null;

describe('export assets', () => {
	const body = 'See ![chart](blob:img1) and [Plan.docx](blob:doc1), not blob:http://x/y or blob:gone1.';

	it('finds the refs a note uses, not object URLs', () => {
		expect(blobRefsOf(memory({ bodyMarkdown: body, rawAudioRef: 'blob:rec1' })).sort()).toEqual(
			['blob:doc1', 'blob:gone1', 'blob:img1', 'blob:rec1']
		);
	});

	it('names files by type or by the link text, and skips missing blobs', async () => {
		const assets = await collectAssets([memory({ bodyMarkdown: body, rawAudioRef: 'blob:rec1' })], read);
		expect(Object.fromEntries(assets.names)).toEqual({ 'blob:img1': 'img1.avif', 'blob:doc1': 'doc1.docx', 'blob:rec1': 'rec1.webm' });
	});

	it('links relative to the note and leaves unknown refs alone', () => {
		const names = new Map([['blob:img1', 'img1.avif']]);
		expect(linkAssets('![a](blob:img1) blob:gone1', names, 2)).toBe('![a](../../assets/img1.avif) blob:gone1');
	});

	it('puts the files in the ZIP next to the notes that use them', async () => {
		const notes = [memory({ bodyMarkdown: body, folderId: 'f1', rawAudioRef: 'blob:rec1' })];
		const folders = [{ id: 'f1', name: 'Work', parentId: null, vaultId: 'v' } as Folder];
		const assets = await collectAssets(notes, read);
		const files = exportMemoriesToFiles(notes, folders, { id: 'v', name: 'Main' } as Vault, { format: 'vanilla' }, 'main', assets);
		expect(files.map((f) => f.path).sort()).toEqual(['main/assets/doc1.docx', 'main/assets/img1.avif', 'main/assets/rec1.webm', 'main/work/note.md']);
		const md = files.find((f) => f.path.endsWith('note.md'))!.content as string;
		expect(md).toContain('![chart](../assets/img1.avif)');
		expect(md).toContain('[Plan.docx](../assets/doc1.docx)');
		expect(md).toContain('[Recording](../assets/rec1.webm)');
	});
});
