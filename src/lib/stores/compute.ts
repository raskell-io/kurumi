/**
 * What database computations need (relations, rollups, formulas), from the
 * stores: notes by id and each database's properties. See ComputeContext.
 */

import { derived } from 'svelte/store';
import { memoryObjects, databaseViews, todayIso, type PropertyDefinition } from '$lib/db';
import type { ComputeContext } from '$lib/database';

export const computeContext = derived([memoryObjects, databaseViews], ([$memories, $views]): ComputeContext => {
	const schemas = new Map<string, PropertyDefinition[]>();
	for (const v of [...$views].sort((a, b) => a.createdAt - b.createdAt)) {
		if (!schemas.has(v.folderId)) schemas.set(v.folderId, v.properties);
	}
	return {
		byId: new Map($memories.map((m) => [m.id, m])),
		schemaOf: (folderId) => (folderId ? (schemas.get(folderId) ?? []) : []),
		today: todayIso()
	};
});
