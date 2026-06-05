import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionData } from '../../src/types';
import {
  validateSession,
  newSessionData,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from '../../src/lib/session';

vi.mock('../../src/lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

const base: Omit<SessionData, 'createdAt' | 'lastSeenAt'> = {
  userId: 'u1',
  name: 'Matt',
  gen: 'founder',
  brand_id: 'wkrp',
};

describe('validateSession', () => {
  let kv: ReturnType<typeof createMockKV>;
  const now = 1_000_000_000_000;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('returns absent when token has no session', async () => {
    const r = await validateSession(kv, 'missing', now);
    expect(r).toEqual({ ok: false, reason: 'absent' });
  });

  it('accepts a fresh session', async () => {
    await kv.put('wkrp:session:t', JSON.stringify(newSessionData(base, now)));
    const r = await validateSession(kv, 't', now);
    expect(r.ok).toBe(true);
  });

  it('expires past the absolute lifetime and deletes it', async () => {
    await kv.put('wkrp:session:t', JSON.stringify(newSessionData(base, now)));
    const r = await validateSession(kv, 't', now + SESSION_ABSOLUTE_MS + 1);
    expect(r).toEqual({ ok: false, reason: 'expired' });
    expect(await kv.get('wkrp:session:t')).toBeNull();
  });

  it('expires after the idle window even when under absolute cap', async () => {
    // created recently, but last seen long ago
    await kv.put('wkrp:session:t', JSON.stringify({ ...base, createdAt: now, lastSeenAt: now }));
    const r = await validateSession(kv, 't', now + SESSION_IDLE_MS + 1);
    expect(r).toEqual({ ok: false, reason: 'expired' });
    expect(await kv.get('wkrp:session:t')).toBeNull();
  });

  it('touches lastSeenAt (throttled) and preserves createdAt', async () => {
    await kv.put('wkrp:session:t', JSON.stringify({ ...base, createdAt: now, lastSeenAt: now }));
    const later = now + 2 * 60 * 60 * 1000; // 2h > touch threshold
    const r = await validateSession(kv, 't', later);
    expect(r.ok).toBe(true);
    const stored = JSON.parse((await kv.get('wkrp:session:t'))!) as SessionData;
    expect(stored.createdAt).toBe(now);
    expect(stored.lastSeenAt).toBe(later);
  });

  it('does not write back within the touch throttle window', async () => {
    await kv.put('wkrp:session:t', JSON.stringify({ ...base, createdAt: now, lastSeenAt: now }));
    (kv.put as ReturnType<typeof vi.fn>).mockClear();
    await validateSession(kv, 't', now + 60 * 1000); // 1 min < 1h
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('backfills lifetime anchors for legacy anchorless sessions', async () => {
    await kv.put('wkrp:session:t', JSON.stringify({ ...base })); // no anchors
    const r = await validateSession(kv, 't', now);
    expect(r.ok).toBe(true);
    const stored = JSON.parse((await kv.get('wkrp:session:t'))!) as SessionData;
    expect(stored.createdAt).toBe(now);
    expect(stored.lastSeenAt).toBe(now);
  });
});
