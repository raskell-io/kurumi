/**
 * Export utilities for generating vCard, iCal, and CSV files
 * Frontend-only - these don't modify the database
 */

import type { PersonWithMetadata, DateWithEvents } from '../db/store';
import type { Event } from '../db/types';

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

	if (person.person) {
		if (person.person.email) {
			lines.push(`EMAIL:${escapeVCardValue(person.person.email)}`);
		}
		if (person.person.phone) {
			lines.push(`TEL:${escapeVCardValue(person.person.phone)}`);
		}
		if (person.person.company) {
			lines.push(`ORG:${escapeVCardValue(person.person.company)}`);
		}
		if (person.person.title) {
			lines.push(`TITLE:${escapeVCardValue(person.person.title)}`);
		}

		// Custom fields as NOTE
		if (person.person.customFields) {
			const customFields: string[] = [];
			for (const [key, value] of Object.entries(person.person.customFields)) {
				if (value) {
					customFields.push(`${key}: ${value}`);
				}
			}
			if (customFields.length > 0) {
				lines.push(`NOTE:${escapeVCardValue(customFields.join('\\n'))}`);
			}
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
			lines.push(eventToVEvent(event));
		}

		// If no events but date is mentioned, create a basic all-day event
		if (dateInfo.events.length === 0 && dateInfo.mentioningNotes.length > 0) {
			const note = dateInfo.mentioningNotes[0];
			lines.push(createAllDayVEvent(dateInfo.date, note.id, note.title || 'Event'));
		}
	}

	lines.push('END:VCALENDAR');
	return lines.join('\r\n');
}

function eventToVEvent(event: Event): string {
	const dateFormatted = event.date.replace(/-/g, '');
	const uid = `${event.id}@kurumi.app`;
	const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

	const lines: string[] = [
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`DTSTAMP:${now}`
	];

	// Handle time if provided
	if (event.time) {
		const time = event.time.replace(':', '');
		lines.push(`DTSTART:${dateFormatted}T${time}00`);

		// Handle duration
		if (event.duration) {
			const durationMatch = event.duration.match(/(\d+)h?/);
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
	lines.push(`SUMMARY:${escapeICalValue(event.title || 'Event')}`);

	// Location
	if (event.location) {
		lines.push(`LOCATION:${escapeICalValue(event.location)}`);
	}

	// Attendees
	if (event.attendees && event.attendees.length > 0) {
		lines.push(`DESCRIPTION:${escapeICalValue('Attendees: ' + event.attendees.join(', '))}`);
	}

	lines.push('END:VEVENT');
	return lines.join('\r\n');
}

function createAllDayVEvent(date: string, id: string, title: string): string {
	const dateFormatted = date.replace(/-/g, '');
	const uid = `${id}@kurumi.app`;
	const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

	const lines: string[] = [
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`DTSTAMP:${now}`,
		`DTSTART;VALUE=DATE:${dateFormatted}`,
		`DTEND;VALUE=DATE:${dateFormatted}`,
		`SUMMARY:${escapeICalValue(title)}`,
		'END:VEVENT'
	];

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
	// Collect all unique custom field keys
	const customKeys = new Set<string>();
	for (const person of people) {
		if (person.person?.customFields) {
			for (const key of Object.keys(person.person.customFields)) {
				customKeys.add(key);
			}
		}
	}

	const columns = ['name', 'mentions', 'email', 'phone', 'company', 'title', ...Array.from(customKeys)];
	const data = people.map((person) => {
		const row: Record<string, unknown> = {
			name: person.name,
			mentions: person.count,
			email: person.person?.email ?? '',
			phone: person.person?.phone ?? '',
			company: person.person?.company ?? '',
			title: person.person?.title ?? ''
		};
		if (person.person?.customFields) {
			for (const key of customKeys) {
				row[key] = person.person.customFields[key] ?? '';
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
					date: event.date,
					title: event.title || '',
					time: event.time || '',
					duration: event.duration || '',
					location: event.location || '',
					attendees: event.attendees?.join(', ') || '',
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
				attendees: '',
				notes: dateInfo.mentioningNotes.length
			});
		}
	}

	return toCSV(data, ['date', 'title', 'time', 'duration', 'location', 'attendees', 'notes']);
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
