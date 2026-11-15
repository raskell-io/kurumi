/**
 * Which note a [[link]] points at. The one place that decides it; everything
 * else asks a `LinkResolver` built by `buildLinkIndex`.
 *
 * Two modes:
 *
 *   title mode (default)  a note is addressed by its title, case-insensitively.
 *                         This is how Kurumi vaults have always resolved links.
 *   key mode (`linkKeyOf`) a note is addressed by a key the caller reads from
 *                         it (a frontmatter id such as `project.foo`), then by
 *                         each fallback in order (title, filename, …). A key
 *                         always beats a fallback: `[[foo]]` is the note whose
 *                         key is `foo` before it is a note titled "Foo".
 *
 * Parsing stays with `$lib/wikilinks` (`parseWikilink`): only a link's
 * `target` takes part, never its alias, heading or block.
 *
 * Pure: takes notes, keeps no state outside the resolver it returns.
 */

import { parseWikilink, wikilinkLabel } from '$lib/wikilinks';

export interface LinkableNote {
	id: string;
	title: string;
	bodyMarkdown?: string | null;
}

/** A name a note answers to; null or undefined when it has none. */
export type LinkName<N> = (note: N) => string | null | undefined;

export interface LinkIndexOptions<N> {
	/** Key mode: the note's own key. Leave out for title mode. */
	linkKeyOf?: LinkName<N>;
	/** Names tried after the key, in order. Default: the title. */
	fallbacks?: LinkName<N>[];
	/** Which note wins when several share a name, in the order given. Default 'first'. */
	prefer?: 'first' | 'last';
	/** Ignore spaces around names and targets. Default: only in key mode. */
	trim?: boolean;
}

export interface LinkResolver<N extends LinkableNote = LinkableNote> {
	/** The note `target` points at: by key, then by each fallback. */
	resolve(target: string): N | undefined;
	/** What [[…]] should contain to link to this note. */
	keyOf(note: N): string;
	/**
	 * Whether a link to `target` is a link to `note`. In title mode that is
	 * "the target is its title", so notes sharing a title all count (as they
	 * always have for backlinks); in key mode only the note `resolve` returns.
	 */
	isLinkTo(target: string, note: N): boolean;
	/** Other notes with a link to this one (see `isLinkTo`), in the order given. */
	backlinks(id: string): N[];
	/** The other notes this one's links resolve to, each once, in order of first link. */
	outgoing(id: string): N[];
	/** Names more than one note answers to; `resolve` picks one of `ids`. */
	duplicates(): { key: string; ids: string[] }[];
}

/**
 * The targets this content links to: [[Title]], [[Title|alias]] and
 * [[Title#Heading]] all count as Title. Also reads Milkdown's escaped form
 * \[\[Title]], which older notes may hold.
 */
export function extractLinkTargets(content: string | null | undefined): string[] {
	const links: string[] = [];
	for (const match of (content ?? '').matchAll(/\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g)) {
		const { target } = parseWikilink(match[1]);
		if (target) links.push(target);
	}
	return links;
}

/**
 * What a link shows, given the note it resolves to: its alias, else what it
 * says, except that a link naming its note by something other than the title
 * (`[[project.foo]]`) shows the title.
 */
export function linkLabel(inner: string, note: { title: string } | null | undefined): string {
	const { target, heading, alias } = parseWikilink(inner);
	const title = note?.title.trim();
	if (alias || !target || !title || target.toLowerCase() === title.toLowerCase()) return wikilinkLabel(inner);
	return heading ? `${title} › ${heading}` : title;
}

const titleOf = (note: LinkableNote) => note.title ?? '';

export function buildLinkIndex<N extends LinkableNote>(notes: readonly N[], options: LinkIndexOptions<N> = {}): LinkResolver<N> {
	const keyMode = !!options.linkKeyOf;
	const trim = options.trim ?? keyMode;
	const last = options.prefer === 'last';
	const norm = (name: string) => (trim ? name.trim() : name).toLowerCase();
	// One naming function per tier: the key first, then the fallbacks.
	const tiers: LinkName<N>[] = [...(options.linkKeyOf ? [options.linkKeyOf] : []), ...(options.fallbacks ?? [titleOf])];
	// A note's name in a tier as written, or null. An untitled note keeps its
	// empty title as a name in title mode (it always did); key mode drops
	// empty names.
	const written = (note: N, tier: number): string | null => {
		const name = tiers[tier](note);
		if (name === null || name === undefined) return null;
		return keyMode && !name.trim() ? null : name;
	};

	const byName: Map<string, N[]>[] = tiers.map(() => new Map());
	const byId = new Map<string, N>();
	for (const note of notes) {
		byId.set(note.id, note);
		tiers.forEach((_, tier) => {
			const name = written(note, tier);
			if (name === null) return;
			const key = norm(name);
			const sharing = byName[tier].get(key);
			if (sharing) sharing.push(note);
			else byName[tier].set(key, [note]);
		});
	}

	const resolveKey = (key: string): N | undefined => {
		for (const names of byName) {
			const sharing = names.get(key);
			if (sharing) return last ? sharing[sharing.length - 1] : sharing[0];
		}
		return undefined;
	};

	// Each note's link targets, normalised; read from the body on first use.
	const targets = new Map<string, string[]>();
	const targetsOf = (note: N): string[] => {
		let list = targets.get(note.id);
		if (!list) {
			list = extractLinkTargets(note.bodyMarkdown).map(norm);
			targets.set(note.id, list);
		}
		return list;
	};

	/** Whether a normalised target is a link to `note`. */
	const pointsAt = (note: N): ((key: string) => boolean) => {
		if (keyMode) return (key) => resolveKey(key)?.id === note.id;
		const name = written(note, 0);
		const own = name === null ? null : norm(name);
		return (key) => key === own;
	};

	return {
		resolve: (target) => resolveKey(norm(target)),
		keyOf(note) {
			for (let tier = 0; tier < tiers.length; tier++) {
				const name = written(note, tier);
				if (name !== null) return trim ? name.trim() : name;
			}
			return '';
		},
		isLinkTo: (target, note) => pointsAt(note)(norm(target)),
		backlinks(id) {
			const note = byId.get(id);
			if (!note) return [];
			const hit = pointsAt(note);
			return notes.filter((source) => source.id !== id && targetsOf(source).some(hit));
		},
		outgoing(id) {
			const note = byId.get(id);
			if (!note) return [];
			const found = new Map<string, N>();
			for (const key of targetsOf(note)) {
				const target = resolveKey(key);
				if (target && target.id !== id && !found.has(target.id)) found.set(target.id, target);
			}
			return [...found.values()];
		},
		duplicates() {
			const out: { key: string; ids: string[] }[] = [];
			byName.forEach((names, tier) => {
				for (const [key, sharing] of names) {
					if (!key || sharing.length < 2) continue;
					out.push({ key: (written(sharing[0], tier) ?? key).trim(), ids: sharing.map((n) => n.id) });
				}
			});
			return out;
		}
	};
}
