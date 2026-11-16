/**
 * Dates as people read them, in the user's locale (Intl, no fixed format).
 * One place for it, so the app's date formats can be unified here.
 */

/** The browser's locale(s); undefined lets Intl pick the default. */
const locale = (): string[] | undefined => (typeof navigator !== 'undefined' && navigator.languages?.length ? [...navigator.languages] : undefined);

function parseIsoDay(iso: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return null;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

/** `2026-11-20` → "Nov 20" (this year) or "Nov 20, 2027"; anything else as given. */
export function formatDay(iso: string, now = new Date(), locales: string | string[] | undefined = locale()): string {
	const date = parseIsoDay(iso);
	if (!date) return iso;
	const sameYear = date.getFullYear() === now.getFullYear();
	return new Intl.DateTimeFormat(locales, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}

/** The full date, for a tooltip or a screen reader: "Friday, November 20, 2026". */
export function formatDayLong(iso: string, locales: string | string[] | undefined = locale()): string {
	const date = parseIsoDay(iso);
	if (!date) return iso;
	return new Intl.DateTimeFormat(locales, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * A moment, by when it was: "Today 10:47", "Yesterday 18:02", "Nov 12, 10:47",
 * "Nov 12, 2025, 10:47" (words and order from the locale).
 */
export function formatMoment(time: number | Date, now = new Date(), locales: string | string[] | undefined = locale()): string {
	const date = new Date(time);
	const clock = new Intl.DateTimeFormat(locales, { hour: 'numeric', minute: '2-digit' }).format(date);
	const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
	if (days === 0 || days === 1) {
		const word = new Intl.RelativeTimeFormat(locales, { numeric: 'auto' }).format(-days, 'day');
		return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)} ${clock}`;
	}
	const sameYear = date.getFullYear() === now.getFullYear();
	return new Intl.DateTimeFormat(locales, {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}
