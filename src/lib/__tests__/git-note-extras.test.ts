import { describe, it, expect, vi } from 'vitest';

// The git service pulls in LightningFS / isomorphic-git at import time;
// these tests only exercise the pure conversion and merge helpers.
vi.mock('../git/fs', () => ({}));
vi.mock('isomorphic-git', () => ({ default: {} }));
vi.mock('isomorphic-git/http/web', () => ({ default: {} }));

import { createMetadata, noteToMarkdownFile, parseMarkdownFile } from '../git/convert';
import { parseNotesFromFiles, mergeMemoryLists } from '../git/service';
import type { MemoryObject, Vault } from '../db/types';

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
