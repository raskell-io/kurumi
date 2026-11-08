import { describe, expect, it } from 'vitest';
import { mayCall, parsePlugin, PluginFormatError } from '$lib/plugins/manifest';

const file = (manifest: string, body = 'kurumi.ui.notice("hi");') => `/* kurumi-plugin ${manifest} */\n${body}`;

describe('plugin manifests', () => {
	it('reads the manifest from the leading comment', () => {
		expect(parsePlugin(file('{"id":"word-stats","name":"Word stats","version":"1.2.0","description":"Counts","permissions":["read","read"]}'))).toEqual({
			id: 'word-stats',
			name: 'Word stats',
			version: '1.2.0',
			description: 'Counts',
			permissions: ['read']
		});
	});

	it('rejects files that aren’t plugins, with a reason', () => {
		expect(() => parsePlugin('console.log(1)')).toThrow(PluginFormatError);
		expect(() => parsePlugin(file('{nope'))).toThrow(/not valid JSON/);
		expect(() => parsePlugin(file('{"id":"Bad Id","name":"x"}'))).toThrow(/id must be/);
		expect(() => parsePlugin(file('{"id":"ok","name":""}'))).toThrow(/needs a name/);
		expect(() => parsePlugin(file('{"id":"ok","name":"x","permissions":["network"]}'))).toThrow(/Unknown permission: network/);
	});

	it('checks each call against the granted permissions', () => {
		expect(mayCall([], 'commands.register')).toBe(true);
		expect(mayCall([], 'ui.notice')).toBe(true);
		expect(mayCall([], 'notes.list')).toBe(false);
		expect(mayCall(['read'], 'notes.get')).toBe(true);
		expect(mayCall(['read'], 'notes.create')).toBe(false);
		expect(mayCall(['read', 'write'], 'notes.update')).toBe(true);
		expect(mayCall(['read', 'write'], 'storage.wipe')).toBe(false);
	});
});
