import { describe, it, expect } from 'vitest';
import { deriveKey, sealWith, openWith, isSealed, saltOf, WrongPassphraseError } from '../sync/crypto';

describe('sync encryption', () => {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const plain = new TextEncoder().encode('Meeting notes: Falcon launch, budget 120k');

	it('round-trips, and the sealed copy hides the content', async () => {
		const key = await deriveKey('correct horse battery', salt);
		const sealed = await sealWith(key, salt, plain);
		expect(isSealed(sealed)).toBe(true);
		expect(isSealed(plain)).toBe(false);
		expect(saltOf(sealed)).toEqual(salt);
		expect(new TextDecoder().decode(sealed)).not.toContain('Falcon');
		expect(await openWith(key, sealed)).toEqual(plain);
	});

	it('uses a fresh IV every time', async () => {
		const key = await deriveKey('correct horse battery', salt);
		const a = await sealWith(key, salt, plain);
		const b = await sealWith(key, salt, plain);
		expect(a).not.toEqual(b);
	});

	it('rejects a wrong passphrase and tampering', async () => {
		const sealed = await sealWith(await deriveKey('correct horse battery', salt), salt, plain);
		await expect(openWith(await deriveKey('wrong horse battery', salt), sealed)).rejects.toBeInstanceOf(WrongPassphraseError);
		const tampered = sealed.slice();
		tampered[tampered.length - 1] ^= 1;
		await expect(openWith(await deriveKey('correct horse battery', salt), tampered)).rejects.toBeInstanceOf(WrongPassphraseError);
	});
});
