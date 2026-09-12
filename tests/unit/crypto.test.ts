/**
 * Unit tests — data-at-rest encryption (F2 auth hardening).
 *
 * AES-256-GCM round-trip, self-describing ciphertext, non-breaking rollout
 * (encrypt-if-key on write; read tolerates legacy plaintext), and fail-safe
 * behavior when a value is encrypted but no key is available.
 */
import { describe, it, expect } from 'vitest';
import { encryptString, decryptString, isEncrypted, sealJSON, openJSON } from '../../src/lib/crypto';

// A deterministic 32-byte (AES-256) key, base64-encoded.
const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const KEY2 = Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64');

describe('crypto (data-at-rest)', () => {
  it('round-trips a string through encrypt/decrypt', async () => {
    const ct = await encryptString('hunter2-refresh-token', KEY);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain('hunter2'); // ciphertext does not leak plaintext
    expect(await decryptString(ct, KEY)).toBe('hunter2-refresh-token');
  });

  it('produces a fresh IV each time (same plaintext → different ciphertext)', async () => {
    const a = await encryptString('same', KEY);
    const b = await encryptString('same', KEY);
    expect(a).not.toEqual(b);
    expect(await decryptString(a, KEY)).toBe('same');
    expect(await decryptString(b, KEY)).toBe('same');
  });

  it('fails to decrypt with the wrong key', async () => {
    const ct = await encryptString('secret', KEY);
    await expect(decryptString(ct, KEY2)).rejects.toBeTruthy();
  });

  it('rejects a key that is not 32 bytes', async () => {
    await expect(encryptString('x', Buffer.from('short').toString('base64'))).rejects.toThrow(/32 bytes/);
  });

  describe('sealJSON / openJSON', () => {
    const value = { access_token: 'a', refresh_token: 'r', expires_at: 123 };

    it('seals to ciphertext with a key and opens it back', async () => {
      const sealed = await sealJSON(value, KEY);
      expect(isEncrypted(sealed)).toBe(true);
      expect(await openJSON(sealed, KEY)).toEqual(value);
    });

    it('stores plaintext JSON when no key is provided (non-breaking rollout)', async () => {
      const sealed = await sealJSON(value, undefined);
      expect(isEncrypted(sealed)).toBe(false);
      expect(JSON.parse(sealed)).toEqual(value);
    });

    it('reads legacy plaintext JSON even when a key is provided (back-compat)', async () => {
      const legacy = JSON.stringify(value);
      expect(await openJSON(legacy, KEY)).toEqual(value);
    });

    it('returns null when a value is encrypted but no key is available (fail-safe)', async () => {
      const sealed = await sealJSON(value, KEY);
      expect(await openJSON(sealed, undefined)).toBeNull();
    });
  });
});
