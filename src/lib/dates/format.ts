/**
 * One way to write a date or a time anywhere in the interface.
 *
 * Dates follow the device's language and region (Intl), so the order of day
 * and month and the month names are the reader's own; the words around them
 * ("Today", "just now", "ago") are the app's, in English like the rest of it.
 * Nothing here is for storage: stored dates stay ISO (`YYYY-MM-DD`) or epoch
 * milliseconds, and never reach the screen as such.
 *
 * Styles:
 *   day           "Nov 16"            (the year only when it isn't this year: "Nov 16, 2025")
 *   day-weekday   "Mon, Nov 16"
 *   day-long      "Monday, November 16"
 *   month         "November 2026"
 *   time          "10:47 AM"
 *   day-time      "Nov 16, 10:47 AM"
 *   relative      "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", then "Nov 16"
 *   due           "Today", "Tomorrow", "Yesterday", "Fri" (within the week ahead), then "Nov 16"
 *
 * Every function takes a Date, epoch milliseconds or an ISO string. A bare
 * ISO day (`2026-11-16`) is that day in local time, never UTC midnight (which
 * shows as the day before west of Greenwich).
 */

export type DateInput = Date | number | string;

export type DateStyle = 'day' | 'day-weekday' | 'day-long' | 'month' | 'time' | 'day-time' | 'relative' | 'due';

export interface FormatOptions {
	/** "Now" for relative styles and for "this year" (tests pass a fixed one). */
	now?: DateInput;
	/** A BCP 47 locale; the device's own when left out. */
	locale?: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Date for any input; an invalid one for anything unreadable. */
export function toDate(value: DateInput): Date {
	if (value instanceof Date) return new Date(value.getTime());
	if (typeof value === 'number') return new Date(value);
	const m = ISO_DAY.exec(value.trim());
	if (m) {
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
		// "2026-02-30" is not a day: no rolling over into March.
		return d.getMonth() === Number(m[2]) - 1 ? d : new Date(NaN);
	}
	return new Date(value);
}

function valid(d: Date): boolean {
	return !Number.isNaN(d.getTime());
}

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to `value` (negative in the past). */
export function daysFrom(value: DateInput, now: DateInput = new Date()): number {
	return Math.round((startOfDay(toDate(value)) - startOfDay(toDate(now))) / 86_400_000);
}

// Intl formatters are slow to build and used in long lists: keep them.
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
	let f = cache.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat(locale, opts);
		cache.set(key, f);
	}
	return f;
}

function sameYear(d: Date, now: Date): boolean {
	return d.getFullYear() === now.getFullYear();
}

/** "Nov 16", or "Nov 16, 2025" in another year. */
export function formatDay(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const now = toDate(opts.now ?? new Date());
	return fmt(opts.locale, { month: 'short', day: 'numeric', ...(sameYear(d, now) ? {} : { year: 'numeric' }) }).format(d);
}

/** "Mon, Nov 16", or "Mon, Nov 16, 2025" in another year. */
export function formatDayWithWeekday(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const now = toDate(opts.now ?? new Date());
	return fmt(opts.locale, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear(d, now) ? {} : { year: 'numeric' }) }).format(d);
}

/** "Monday, November 16", with the year in another year. */
export function formatDayLong(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const now = toDate(opts.now ?? new Date());
	return fmt(opts.locale, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear(d, now) ? {} : { year: 'numeric' }) }).format(d);
}

/** "November 2026" */
export function formatMonth(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	return fmt(opts.locale, { month: 'long', year: 'numeric' }).format(d);
}

/** "10:47 AM" (or "10:47" where the clock has 24 hours) */
export function formatTime(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	return fmt(opts.locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

/** "Nov 16, 10:47 AM"; "Today, 10:47 AM" and "Yesterday, 10:47 AM" close by. */
export function formatDayTime(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const days = daysFrom(d, opts.now ?? new Date());
	const day = days === 0 ? 'Today' : days === -1 ? 'Yesterday' : formatDay(d, opts);
	return `${day}, ${formatTime(d, opts)}`;
}

/**
 * How long ago, in words, for a moment in the past: "just now",
 * "5 min ago", "3 hours ago", "yesterday", "4 days ago", then the day.
 * A moment in the future (a clock that is off) reads "just now".
 */
export function formatRelative(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const now = toDate(opts.now ?? new Date());
	const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	const days = -daysFrom(d, now);
	if (hours < 24 && days === 0) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
	if (days <= 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	return formatDay(d, opts);
}

/**
 * A due date as a word where one fits: "Today", "Tomorrow", "Yesterday",
 * the weekday within the week ahead ("Fri"), otherwise the day ("Nov 16").
 */
export function formatDue(value: DateInput, opts: FormatOptions = {}): string {
	const d = toDate(value);
	if (!valid(d)) return typeof value === 'string' ? value : '';
	const days = daysFrom(d, opts.now ?? new Date());
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	if (days === -1) return 'Yesterday';
	if (days > 1 && days < 7) return fmt(opts.locale, { weekday: 'short' }).format(d);
	return formatDay(d, opts);
}

/** Any style by name (for places that take the style as data). */
export function formatDate(value: DateInput, style: DateStyle = 'day', opts: FormatOptions = {}): string {
	switch (style) {
		case 'day':
			return formatDay(value, opts);
		case 'day-weekday':
			return formatDayWithWeekday(value, opts);
		case 'day-long':
			return formatDayLong(value, opts);
		case 'month':
			return formatMonth(value, opts);
		case 'time':
			return formatTime(value, opts);
		case 'day-time':
			return formatDayTime(value, opts);
		case 'relative':
			return formatRelative(value, opts);
		case 'due':
			return formatDue(value, opts);
	}
}

/**
 * A moment, by when it was: "Today 10:47 AM", "Yesterday 18:02", "Nov 12, 10:47 AM",
 * "Jan 2, 2025, 8:00 AM" (words and order from the locale); with `seconds`, to
 * tell apart two moments in one minute.
 */
export function formatMoment(value: DateInput, opts: FormatOptions & { seconds?: boolean } = {}): string {
	const d = toDate(value);
	if (!valid(d)) return '';
	const now = toDate(opts.now ?? new Date());
	const sec = opts.seconds ? ({ second: '2-digit' } as const) : {};
	const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
	if (days === 0 || days === 1) {
		const clock = fmt(opts.locale, { hour: 'numeric', minute: '2-digit', ...sec }).format(d);
		const word = new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto' }).format(-days, 'day');
		return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)} ${clock}`;
	}
	return fmt(opts.locale, {
		month: 'short',
		day: 'numeric',
		...(sameYear(d, now) ? {} : { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit',
		...sec
	}).format(d);
}
