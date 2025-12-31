/**
 * Frontmatter parsing utilities for YAML metadata in notes
 *
 * Format:
 * ---
 * type: person
 * email: john@example.com
 * custom_field: value
 * ---
 *
 * Note content here...
 */

export interface Frontmatter {
	type?: 'person' | 'event' | string;
	[key: string]: unknown;
}

export interface ParsedContent {
	frontmatter: Frontmatter;
	body: string;
	hasFrontmatter: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter from note content
 */
export function parseFrontmatter(content: string): ParsedContent {
	const match = content.match(FRONTMATTER_REGEX);

	if (!match) {
		return {
			frontmatter: {},
			body: content,
			hasFrontmatter: false
		};
	}

	const yamlContent = match[1];
	const body = content.slice(match[0].length);
	const frontmatter = parseYaml(yamlContent);

	return {
		frontmatter,
		body,
		hasFrontmatter: true
	};
}

/**
 * Simple YAML parser for frontmatter
 * Supports: strings, numbers, booleans, arrays, nested objects (1 level)
 */
function parseYaml(yaml: string): Frontmatter {
	const result: Frontmatter = {};
	const lines = yaml.split('\n');
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for (const line of lines) {
		// Skip empty lines and comments
		if (!line.trim() || line.trim().startsWith('#')) {
			continue;
		}

		// Array item (starts with "  - ")
		if (line.match(/^\s+-\s+/)) {
			if (currentKey && currentArray) {
				const value = line.replace(/^\s+-\s+/, '').trim();
				currentArray.push(parseValue(value) as string);
			}
			continue;
		}

		// Key-value pair
		const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
		if (kvMatch) {
			// Save previous array if exists
			if (currentKey && currentArray) {
				result[currentKey] = currentArray;
				currentArray = null;
			}

			const [, key, rawValue] = kvMatch;
			currentKey = key;
			const value = rawValue.trim();

			// Empty value means array follows
			if (!value) {
				currentArray = [];
			} else {
				result[key] = parseValue(value);
				currentArray = null;
			}
		}
	}

	// Save final array if exists
	if (currentKey && currentArray) {
		result[currentKey] = currentArray;
	}

	return result;
}

/**
 * Parse a YAML value (string, number, boolean)
 */
function parseValue(value: string): string | number | boolean {
	// Remove quotes if present
	if ((value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}

	// Boolean
	if (value.toLowerCase() === 'true') return true;
	if (value.toLowerCase() === 'false') return false;

	// Number
	if (/^-?\d+(\.\d+)?$/.test(value)) {
		return parseFloat(value);
	}

	// String (default)
	return value;
}

/**
 * Serialize frontmatter and body back to content
 */
export function serializeFrontmatter(frontmatter: Frontmatter, body: string): string {
	if (Object.keys(frontmatter).length === 0) {
		return body;
	}

	const yamlLines: string[] = ['---'];

	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) continue;

		if (Array.isArray(value)) {
			yamlLines.push(`${key}:`);
			for (const item of value) {
				yamlLines.push(`  - ${serializeValue(item)}`);
			}
		} else {
			yamlLines.push(`${key}: ${serializeValue(value)}`);
		}
	}

	yamlLines.push('---');
	yamlLines.push('');

	return yamlLines.join('\n') + body;
}

/**
 * Serialize a value for YAML output
 */
function serializeValue(value: unknown): string {
	if (typeof value === 'string') {
		// Quote if contains special chars
		if (value.includes(':') || value.includes('#') || value.includes('\n')) {
			return `"${value.replace(/"/g, '\\"')}"`;
		}
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return String(value);
}

/**
 * Update frontmatter in content with new values
 */
export function updateFrontmatter(content: string, updates: Partial<Frontmatter>): string {
	const { frontmatter, body } = parseFrontmatter(content);
	const newFrontmatter = { ...frontmatter, ...updates };

	// Remove undefined values
	for (const key of Object.keys(newFrontmatter)) {
		if (newFrontmatter[key] === undefined) {
			delete newFrontmatter[key];
		}
	}

	return serializeFrontmatter(newFrontmatter, body);
}

/**
 * Remove a field from frontmatter
 */
export function removeFrontmatterField(content: string, field: string): string {
	const { frontmatter, body } = parseFrontmatter(content);
	delete frontmatter[field];
	return serializeFrontmatter(frontmatter, body);
}

/**
 * Check if content has frontmatter with a specific type
 */
export function hasFrontmatterType(content: string, type: string): boolean {
	const { frontmatter } = parseFrontmatter(content);
	return frontmatter.type === type;
}

/**
 * Get frontmatter type from content
 */
export function getFrontmatterType(content: string): string | undefined {
	const { frontmatter } = parseFrontmatter(content);
	return frontmatter.type as string | undefined;
}

/**
 * Create person frontmatter template
 */
export function createPersonFrontmatter(name: string): string {
	return serializeFrontmatter(
		{
			type: 'person',
			email: '',
			phone: ''
		},
		`# ${name}\n\n`
	);
}

/**
 * Create event frontmatter template
 */
export function createEventFrontmatter(date: string, title?: string): string {
	return serializeFrontmatter(
		{
			type: 'event',
			title: title || '',
			time: '',
			location: ''
		},
		`//${date}\n\n`
	);
}
