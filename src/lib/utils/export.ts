/**
 * Export utilities for generating vCard, iCal, and CSV files
 * Frontend-only - these don't modify the database
 */

import type { PersonWithMetadata, DateWithEvents, Note } from '../db/store';

// ============ vCard Export ============

/**
 * Generate vCard format for people
 * https://en.wikipedia.org/wiki/VCard
 */
export function peopleToVCard(people: PersonWithMetadata[]): string {
	return people
		.map((person) => personToVCard(person))
		.join('\n');
}

export function personToVCard(person: PersonWithMetadata): string {
	const lines: string[] = [
		'BEGIN:VCARD',
		'VERSION:3.0',
		`FN:${escapeVCardValue(person.name)}`
	];

	// Parse name into parts (First Last format assumed)
	const nameParts = person.name.split(' ');
	if (nameParts.length >= 2) {
		const lastName = nameParts.pop()!;
		const firstName = nameParts.join(' ');
		lines.push(`N:${escapeVCardValue(lastName)};${escapeVCardValue(firstName)};;;`);
	} else {
		lines.push(`N:${escapeVCardValue(person.name)};;;;`);
	}

	if (person.metadata) {
		if (person.metadata.email) {
			lines.push(`EMAIL:${escapeVCardValue(String(person.metadata.email))}`);
		}
		if (person.metadata.phone) {
			lines.push(`TEL:${escapeVCardValue(String(person.metadata.phone))}`);
		}
		if (person.metadata.company) {
			lines.push(`ORG:${escapeVCardValue(String(person.metadata.company))}`);
		}
		if (person.metadata.title) {
			lines.push(`TITLE:${escapeVCardValue(String(person.metadata.title))}`);
		}

		// Custom fields as NOTE
		const customFields: string[] = [];
		for (const [key, value] of Object.entries(person.metadata)) {
			if (!['type', 'email', 'phone', 'company', 'title'].includes(key) && value) {
				customFields.push(`${key}: ${value}`);
			}
		}
		if (customFields.length > 0) {
			lines.push(`NOTE:${escapeVCardValue(customFields.join('\\n'))}`);
		}
	}

	lines.push('END:VCARD');
	return lines.join('\r\n');
}

function escapeVCardValue(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;')
		.replace(/\n/g, '\\n');
}

// ============ iCal Export ============

/**
 * Generate iCal format for events
 * https://en.wikipedia.org/wiki/ICalendar
 */
export function eventsToICal(dates: DateWithEvents[]): string {
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Kurumi//Kurumi Second Brain//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH'
	];

	for (const dateInfo of dates) {
		for (const event of dateInfo.events) {
			lines.push(eventToVEvent(dateInfo.date, event.note, event.metadata));
		}

		// If no events but date is mentioned, create a basic all-day event
		if (dateInfo.events.length === 0 && dateInfo.mentioningNotes.length > 0) {
			const note = dateInfo.mentioningNotes[0];
			lines.push(eventToVEvent(dateInfo.date, note, null));
		}
	}

	lines.push('END:VCALENDAR');
	return lines.join('\r\n');
}

function eventToVEvent(
	date: string,
	note: Note,
	metadata: { title?: string; time?: string; duration?: string; location?: string; [key: string]: unknown } | null
): string {
	const dateFormatted = date.replace(/-/g, '');
	const uid = `${note.id}@kurumi.app`;
	const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

	const lines: string[] = [
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`DTSTAMP:${now}`
	];

	// Handle time if provided
	if (metadata?.time) {
		const time = String(metadata.time).replace(':', '');
		lines.push(`DTSTART:${dateFormatted}T${time}00`);

		// Handle duration
		if (metadata.duration) {
			const durationMatch = String(metadata.duration).match(/(\d+)h?/);
			if (durationMatch) {
				const hours = parseInt(durationMatch[1]);
				lines.push(`DURATION:PT${hours}H`);
			}
		} else {
			lines.push('DURATION:PT1H'); // Default 1 hour
		}
	} else {
		// All-day event
		lines.push(`DTSTART;VALUE=DATE:${dateFormatted}`);
		lines.push(`DTEND;VALUE=DATE:${dateFormatted}`);
	}

	// Title
	const title = metadata?.title || note.title || 'Event';
	lines.push(`SUMMARY:${escapeICalValue(title)}`);

	// Location
	if (metadata?.location) {
		lines.push(`LOCATION:${escapeICalValue(String(metadata.location))}`);
	}

	// Description from note content
	const description = note.content
		.replace(/^---[\s\S]*?---\n?/, '') // Remove frontmatter
		.slice(0, 500); // Limit length
	if (description.trim()) {
		lines.push(`DESCRIPTION:${escapeICalValue(description)}`);
	}

	lines.push('END:VEVENT');
	return lines.join('\r\n');
}

function escapeICalValue(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;')
		.replace(/\n/g, '\\n');
}

// ============ CSV Export ============

/**
 * Generic CSV generator
 */
export function toCSV(data: Record<string, unknown>[], columns: string[]): string {
	const header = columns.map((col) => escapeCSVValue(col)).join(',');
	const rows = data.map((row) =>
		columns.map((col) => escapeCSVValue(String(row[col] ?? ''))).join(',')
	);
	return [header, ...rows].join('\n');
}

function escapeCSVValue(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Export people to CSV
 */
export function peopleToCSV(people: PersonWithMetadata[]): string {
	// Collect all unique metadata keys
	const metadataKeys = new Set<string>();
	for (const person of people) {
		if (person.metadata) {
			for (const key of Object.keys(person.metadata)) {
				if (key !== 'type') {
					metadataKeys.add(key);
				}
			}
		}
	}

	const columns = ['name', 'mentions', ...Array.from(metadataKeys)];
	const data = people.map((person) => {
		const row: Record<string, unknown> = {
			name: person.name,
			mentions: person.count
		};
		if (person.metadata) {
			for (const key of metadataKeys) {
				row[key] = person.metadata[key] ?? '';
			}
		}
		return row;
	});

	return toCSV(data, columns);
}

/**
 * Export events to CSV
 */
export function eventsToCSV(dates: DateWithEvents[]): string {
	const data: Record<string, unknown>[] = [];

	for (const dateInfo of dates) {
		if (dateInfo.events.length > 0) {
			for (const event of dateInfo.events) {
				data.push({
					date: dateInfo.date,
					title: event.metadata?.title || event.note.title || '',
					time: event.metadata?.time || '',
					duration: event.metadata?.duration || '',
					location: event.metadata?.location || '',
					notes: dateInfo.mentioningNotes.length
				});
			}
		} else {
			data.push({
				date: dateInfo.date,
				title: '',
				time: '',
				duration: '',
				location: '',
				notes: dateInfo.mentioningNotes.length
			});
		}
	}

	return toCSV(data, ['date', 'title', 'time', 'duration', 'location', 'notes']);
}

/**
 * Export tags to CSV
 */
export function tagsToCSV(tags: { tag: string; count: number }[]): string {
	return toCSV(
		tags.map((t) => ({ tag: t.tag, notes: t.count })),
		['tag', 'notes']
	);
}

/**
 * Export links to CSV
 */
export function linksToCSV(links: { url: string; domain: string; count: number }[]): string {
	return toCSV(
		links.map((l) => ({ url: l.url, domain: l.domain, notes: l.count })),
		['url', 'domain', 'notes']
	);
}

// ============ Download Helpers ============

/**
 * Trigger a file download in the browser
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Download people as vCard
 */
export function downloadPeopleVCard(people: PersonWithMetadata[]): void {
	const content = peopleToVCard(people);
	const filename = `kurumi-contacts-${new Date().toISOString().split('T')[0]}.vcf`;
	downloadFile(content, filename, 'text/vcard');
}

/**
 * Download a single person as vCard
 */
export function downloadPersonVCard(person: PersonWithMetadata): void {
	const content = personToVCard(person);
	const filename = `${person.name.replace(/\s+/g, '-').toLowerCase()}.vcf`;
	downloadFile(content, filename, 'text/vcard');
}

/**
 * Download events as iCal
 */
export function downloadEventsICal(dates: DateWithEvents[]): void {
	const content = eventsToICal(dates);
	const filename = `kurumi-events-${new Date().toISOString().split('T')[0]}.ics`;
	downloadFile(content, filename, 'text/calendar');
}

/**
 * Download people as CSV
 */
export function downloadPeopleCSV(people: PersonWithMetadata[]): void {
	const content = peopleToCSV(people);
	const filename = `kurumi-people-${new Date().toISOString().split('T')[0]}.csv`;
	downloadFile(content, filename, 'text/csv');
}

/**
 * Download events as CSV
 */
export function downloadEventsCSV(dates: DateWithEvents[]): void {
	const content = eventsToCSV(dates);
	const filename = `kurumi-events-${new Date().toISOString().split('T')[0]}.csv`;
	downloadFile(content, filename, 'text/csv');
}

/**
 * Download tags as CSV
 */
export function downloadTagsCSV(tags: { tag: string; count: number }[]): void {
	const content = tagsToCSV(tags);
	const filename = `kurumi-tags-${new Date().toISOString().split('T')[0]}.csv`;
	downloadFile(content, filename, 'text/csv');
}

/**
 * Download links as CSV
 */
export function downloadLinksCSV(links: { url: string; domain: string; count: number }[]): void {
	const content = linksToCSV(links);
	const filename = `kurumi-links-${new Date().toISOString().split('T')[0]}.csv`;
	downloadFile(content, filename, 'text/csv');
}
