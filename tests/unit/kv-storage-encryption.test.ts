/**
 * Unit tests — token encryption at rest via kv-storage (F2 auth hardening).
 *
 * Proves the sensitive credentials (Spotify tokens, Last.fm session keys) are
 * ciphertext in KV when a key is set, round-trip through the getters, and that
 * the rollout is non-breaking (plaintext still readable; no key → plaintext).
 */
import { describe, it, expect } from 'vitest';
import {
  storeTokens, getTokens, storeLastfmSession, getLastfmSession,
} from '../../src/lib/kv-storage';
import { isEncrypted } from '../../src/lib/crypto';
import type { StoredTokens } from '../../src/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const tokens: StoredTokens = { access_token: 'acc', refresh_token: 'ref', expires_at: 999 };

describe('token encryption at rest', () => {
  it('stores Spotify tokens as ciphertext (no plaintext token in KV) when keyed', async () => {
    const kv = fakeKV();
    await storeTokens(kv, 'u1', tokens, KEY);
    const raw = kv.store.get('wkrp:tokens:u1')!;
    expect(isEncrypted(raw)).toBe(true);
    expect(raw).not.toContain('ref'); // refresh token not readable at rest
    expect(await getTokens(kv, 'u1', KEY)).toEqual(tokens);
  });

  it('stores Last.fm session keys as ciphertext when keyed', async () => {
    const kv = fakeKV();
    await storeLastfmSession(kv, 'c1', { username: 'mz', session_key: 'sk_secret' }, KEY);
    const raw = kv.store.get('wkrp:lastfm:c1')!;
    expect(isEncrypted(raw)).toBe(true);
    expect(raw).not.toContain('sk_secret');
    expect(await getLastfmSession(kv, 'c1', KEY)).toEqual({ username: 'mz', session_key: 'sk_secret' });
  });

  it('refuses to store Spotify tokens or a Last.fm key without a key, and writes nothing (CCR F12)', async () => {
    const kv = fakeKV();
    await expect(storeTokens(kv, 'u1', tokens)).rejects.toThrow(/plain text/);
    await expect(storeLastfmSession(kv, 'c1', { username: 'mz', session_key: 'sk_secret' })).rejects.toThrow(/plain text/);
    expect(kv.store.size).toBe(0);
  });

  it('re-seals a legacy plaintext token the first time it is read with a key (CCR F12)', async () => {
    const kv = fakeKV();
    kv.store.set('wkrp:tokens:u1', JSON.stringify(tokens));
    kv.store.set('wkrp:lastfm:c1', JSON.stringify({ username: 'mz', session_key: 'sk_secret' }));
    expect(await getTokens(kv, 'u1', KEY)).toEqual(tokens);
    expect(await getLastfmSession(kv, 'c1', KEY)).toEqual({ username: 'mz', session_key: 'sk_secret' });
    expect(isEncrypted(kv.store.get('wkrp:tokens:u1')!)).toBe(true);
    expect(kv.store.get('wkrp:lastfm:c1')).not.toContain('sk_secret');
    expect(await getTokens(kv, 'u1', KEY)).toEqual(tokens);
  });

  it('does not rewrite a value that is already encrypted', async () => {
    const kv = fakeKV();
    await storeTokens(kv, 'u1', tokens, KEY);
    const sealed = kv.store.get('wkrp:tokens:u1');
    expect(await getTokens(kv, 'u1', KEY)).toEqual(tokens);
    expect(kv.store.get('wkrp:tokens:u1')).toBe(sealed); // a re-seal would change the random IV
  });

  it('leaves a legacy plaintext token as it is when read without a key', async () => {
    const kv = fakeKV();
    kv.store.set('wkrp:tokens:u1', JSON.stringify(tokens));
    expect(await getTokens(kv, 'u1')).toEqual(tokens);
    expect(isEncrypted(kv.store.get('wkrp:tokens:u1')!)).toBe(false);
  });

  it('reads a pre-existing plaintext token even after the key is introduced (rollout)', async () => {
    const kv = fakeKV();
    kv.store.set('wkrp:tokens:u1', JSON.stringify(tokens)); // legacy plaintext write
    expect(await getTokens(kv, 'u1', KEY)).toEqual(tokens);
  });
});
