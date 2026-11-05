import { describe, it, expect, vi } from 'vitest';

// The git service pulls in LightningFS / isomorphic-git at import time;
// these tests only exercise the pure conversion and merge helpers.
vi.mock('../git/fs', () => ({}));
vi.mock('isomorphic-git', () => ({ default: {} }));
vi.mock('isomorphic-git/http/web', () => ({ default: {} }));

import { createMetadata, noteToMarkdownFile, parseMarkdownFile } from '../git/convert';
import { parseNotesFromFiles, mergeMemoryLists } from '../git/service';
import type { MemoryObject, Vault } from '../db/types';

describe('folders of notes pulled from git', () => {
	const folder = (name: string, parentId: string | null = null) => ({ name, parentId });
	const metadata = createMetadata(vault, [], [], [], []);
	metadata.folders = { f1: folder('Client X'), f2: folder('Call Notes', 'f1') };
	const parse = (path: string) => {
		const files = new Map([[path, '---\nid: n1\n---\nbody']]);
		return parseNotesFromFiles(files, metadata, 'v1');
	};

	it('puts a new note in the folder its directory stands for', () => {
		expect(parse('client-x/kickoff.md').memories[0].folderId).toBe('f1');
		expect(parse('client-x/call-notes/kickoff.md').memories[0].folderId).toBe('f2');
		expect(parse('kickoff.md').memories[0].folderId).toBeNull();
	});

	it('adds no folder for a directory it knows', () => {
		expect(parse('client-x/call-notes/kickoff.md').folders.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
	});

	it('makes a new directory a folder, the same one on every pull', () => {
		const first = parse('client-x/new-area/kickoff.md');
		const again = parse('client-x/new-area/kickoff.md');
		const added = first.folders.find((f) => f.name === 'New Area');
		expect(added?.parentId).toBe('f1');
		expect(added?.vaultId).toBe('v1');
		expect(first.memories[0].folderId).toBe(added?.id);
		expect(again.memories[0].folderId).toBe(added?.id);
	});

	it('matches a folder under one whose name has no slug', () => {
		metadata.folders.jp = folder('日本語');
		metadata.folders.sub = folder('Sub', 'jp');
		const parsed = parse('sub/kickoff.md');
		expect(parsed.memories[0].folderId).toBe('sub');
		expect(parsed.folders).toHaveLength(4);
		delete metadata.folders.jp;
		delete metadata.folders.sub;
	});

	it('survives a folder that is its own ancestor in a hand-edited file', () => {
		metadata.folders.loop = folder('Loop', 'loop');
		expect(parse('kickoff.md').memories).toHaveLength(1);
		delete metadata.folders.loop;
	});
});

describe('agent guide in a git repo', () => {
	it('is not read as a note', () => {
		const files = new Map([
			['.kurumi/AGENTS.md', '# guide'],
			['plan.md', '---\nid: n1\n---\nbody']
		]);
		const { memories } = parseNotesFromFiles(files, null, 'v1');
		expect(memories.map((m) => m.id)).toEqual(['n1']);
	});
});

const vault: Vault = { id: 'v1', name: 'Work', created: 1, modified: 1 };

function note(overrides: Partial<MemoryObject>): MemoryObject {
	return {
		id: 'n1',
		type: 'note',
		space: 'personal',
		parentBucket: null,
		folderId: null,
		title: 'Plan',
		rawText: '',
		bodyMarkdown: 'body',
		rawAudioRef: null,
		rawMediaRef: null,
		transcript: null,
		transcriptSegments: [],
		summaryShort: null,
		summaryLong: null,
		createdAt: 1000,
		updatedAt: 2000,
		capturedAt: 1000,
		sourceDevice: null,
		sourceContext: null,
		language: null,
		tags: [],
		controlledLabels: [],
		participants: [],
		entities: [],
		projects: [],
		topics: [],
		dates: [],
		actionItems: [],
		decisions: [],
		relatedMemoryIds: [],
		visibilityScope: 'personal',
		processingState: 'ready',
		processingError: null,
		confidenceScores: {},
		embeddingRef: null,
		meetingExtras: null,
		customProps: {},
		vaultId: 'v1',
		deletedAt: null,
		...overrides
	};
}

function roundTrip(memory: MemoryObject) {
	const file = noteToMarkdownFile(memory, []);
	const metadata = createMetadata(vault, [], [memory], [], []);
	const parsed = parseNotesFromFiles(
		new Map([[file.path, file.content]]),
		JSON.parse(JSON.stringify(metadata)),
		'v1'
	);
	return { file, metadata, remote: parsed.memories[0] };
}

describe('git sync of icons and favorites', () => {
	it('round-trips emoji icons through frontmatter', () => {
		const { file, remote } = roundTrip(note({ icon: '🚀' }));
		expect(file.content).toContain('icon: "🚀"');
		expect(parseMarkdownFile(file.path, file.content).icon).toBe('🚀');
		expect(remote.icon).toBe('🚀');
	});

	it('round-trips image icons and favorites through metadata, not markdown', () => {
		const icon = 'data:image/webp;base64,AAAA';
		const { file, metadata, remote } = roundTrip(
			note({ icon, favoritedAt: 3000, favoriteChangedAt: 3000 })
		);
		expect(file.content).not.toContain('data:image');
		expect(metadata.notes).toEqual({ n1: { icon, favoritedAt: 3000, favoriteChangedAt: 3000 } });
		expect(remote.icon).toBe(icon);
		expect(remote.favoritedAt).toBe(3000);
	});

	it('records an empty extras map so a missing icon is authoritative', () => {
		expect(roundTrip(note({})).metadata.notes).toEqual({});
	});

	it('merges favorites by favoriteChangedAt, independent of edits', () => {
		// Local edited the note later, but remote starred it after that.
		const local = note({ updatedAt: 5000, bodyMarkdown: 'local edit' });
		const remote = note({ updatedAt: 4000, favoritedAt: 6000, favoriteChangedAt: 6000 });
		const [merged] = mergeMemoryLists([local], [remote]);
		expect(merged.bodyMarkdown).toBe('local edit');
		expect(merged.favoritedAt).toBe(6000);

		// Remote unstarred after local starred: unstar wins.
		const starred = note({ favoritedAt: 1000, favoriteChangedAt: 1000 });
		const unstarred = note({ favoriteChangedAt: 7000 });
		const [m2] = mergeMemoryLists([starred], [unstarred]);
		expect(m2.favoritedAt).toBeUndefined();
		expect(m2.favoriteChangedAt).toBe(7000);
	});
});
