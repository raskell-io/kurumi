/**
 * Which tabs the strip shows and which it stacks.
 *
 * Tabs share the width that is left beside the note's controls, shrinking
 * evenly down to TAB_MIN (an icon and a few characters). What still does not
 * fit is "stacked": taken out of the strip, in order from the end, and listed
 * behind one control that says how many. The open note's tab is never
 * stacked: it takes the last place in the strip instead.
 */

/** The narrowest a tab gets, px. Matches `.tab-item { min-width }` in the layout. */
export const TAB_MIN = 88;
/** Gap between tabs, px. */
export const TAB_GAP = 2;
/** Room the stack control takes once there is one, px. */
export const STACK_CONTROL = 48;
/** What the tabs can't use: the gap after the pinned group. (The open note's tab is no wider than the rest.) */
export const STRIP_SLACK = 10;

export interface FitTab {
	id: string;
	pinned?: boolean;
}

export function fitTabs<T extends FitTab>(tabs: T[], activeId: string | null, width: number): { visible: T[]; stacked: T[]; tight: boolean } {
	// Not measured yet (first paint, tests without layout): show them all.
	if (!(width > 0)) return { visible: tabs, stacked: [], tight: false };
	const room = width - STRIP_SLACK;
	const needs = (n: number) => n * TAB_MIN + Math.max(0, n - 1) * TAB_GAP;
	// "Tight": the tabs no longer have their natural width.
	const tight = tabs.length * 150 > room;
	if (needs(tabs.length) <= room) return { visible: tabs, stacked: [], tight };

	const count = Math.max(1, Math.floor((room - STACK_CONTROL + TAB_GAP) / (TAB_MIN + TAB_GAP)));
	const visible = tabs.slice(0, count);
	const stacked = tabs.slice(count);
	const hidden = stacked.findIndex((t) => t.id === activeId);
	if (hidden >= 0) {
		const [active] = stacked.splice(hidden, 1);
		// It takes the place of the last ordinary tab shown (pinned ones stay
		// where they are unless there is nothing else).
		let out = visible.length - 1;
		if (!active.pinned) {
			const ordinary = visible.findLastIndex((t) => !t.pinned);
			if (ordinary >= 0) out = ordinary;
		}
		const [displaced] = visible.splice(out, 1);
		visible.push(active);
		stacked.unshift(displaced);
	}
	return { visible, stacked, tight: true };
}
