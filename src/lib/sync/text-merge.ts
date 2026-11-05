/**
 * Three-way merge by lines (diff3), for when a note was edited both in the
 * app and in the sync folder. Returns null when both changed the same lines:
 * deciding between those is the user's call.
 */

// Above this, comparing lines would stall the sync; such a note gets a copy.
const MAX_CELLS = 4_000_000;

// For each line of `a`, the index of the line it matches in `b` (or -1), by
// longest common subsequence.
function matchLines(a: string[], b: string[]): Int32Array | null {
	const out = new Int32Array(a.length).fill(-1);
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		out[start] = start;
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
		out[endA] = endB;
	}
	const n = endA - start;
	const m = endB - start;
	if (n === 0 || m === 0) return out;
	if (n * m > MAX_CELLS) return null;

	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] =
				a[start + i] === b[start + j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[start + i] === b[start + j]) {
			out[start + i] = start + j;
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
		else j++;
	}
	return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i]);

export function mergeText(base: string, ours: string, theirs: string): string | null {
	if (ours === theirs || theirs === base) return ours;
	if (ours === base) return theirs;
	const baseLines = base.split('\n');
	const oursLines = ours.split('\n');
	const theirsLines = theirs.split('\n');
	const toOurs = matchLines(baseLines, oursLines);
	const toTheirs = matchLines(baseLines, theirsLines);
	if (!toOurs || !toTheirs) return null;

	const merged: string[] = [];
	let b = 0;
	let o = 0;
	let t = 0;
	// Walk from one line unchanged on both sides to the next.
	for (let i = 0; i <= baseLines.length; i++) {
		const stable = i === baseLines.length || (toOurs[i] >= 0 && toTheirs[i] >= 0);
		if (!stable) continue;
		const oEnd = i === baseLines.length ? oursLines.length : toOurs[i];
		const tEnd = i === baseLines.length ? theirsLines.length : toTheirs[i];
		const baseRegion = baseLines.slice(b, i);
		const oursRegion = oursLines.slice(o, oEnd);
		const theirsRegion = theirsLines.slice(t, tEnd);
		if (same(oursRegion, baseRegion)) merged.push(...theirsRegion);
		else if (same(theirsRegion, baseRegion) || same(oursRegion, theirsRegion)) merged.push(...oursRegion);
		else return null;
		if (i < baseLines.length) merged.push(baseLines[i]);
		b = i + 1;
		o = oEnd + 1;
		t = tEnd + 1;
	}
	return merged.join('\n');
}
