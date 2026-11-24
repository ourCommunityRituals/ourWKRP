/**
 * Linked music accounts (two-account playlist sync, story 1).
 *
 * Real D1 and KV from Miniflare, the schema from the actual migrations/ files.
 * Each `it` is one rule from the design ("ourWKRP as master copy: two-account
 * Spotify sync", 2026-11-23):
 *   - every existing Spotify link becomes the contributor's source account
 *   - one music account belongs to one contributor
 *   - a contributor has at most one source account
 *   - existing users keep their tokens and keep syncing
 *   - a mirror's tokens are encrypted at rest
 *   - signing in with Spotify records the source account
 *   - erasing linked accounts removes them and the mirror tokens
 *     (erasure calls it: tests/unit/erasure.test.ts)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { applyMigrations, call, resetRig, startRig, type Rig } from '../support/playback-rig';
import { storeAuthState, storeTokens } from '../../src/lib/kv-storage';
import { getValidAccessToken } from '../../src/auth/token-refresh';
import {
  ensureSourceAccount,
  eraseLinkedAccounts,
  getAccountTokens,
  listLinkedAccounts,
  storeAccountTokens,
  tokenKeyFor,
  type LinkedAccount,
} from '../../src/lib/linked-accounts';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

async function addContributor(db: D1Database, id: string, spotifyId: string | null): Promise<void> {
  await db.prepare(
    `INSERT INTO contributors (id, name, generation, brand_id, spotify_user_id, spotify_display_name, created_at)
     VALUES (?, ?, 'founder', 'wkrp', ?, ?, '2026-11-23T00:00:00Z')`,
  ).bind(id, `name-${id}`, spotifyId, spotifyId ? `display-${spotifyId}` : null).run();
}

async function addLinked(db: D1Database, id: string, contributorId: string, spotifyId: string, role: 'source' | 'mirror') {
  return db.prepare(
    `INSERT INTO linked_accounts (id, contributor_id, platform, platform_user_id, role) VALUES (?, ?, 'spotify', ?, ?)`,
  ).bind(id, contributorId, spotifyId, role).run();
}

describe('migration 0013 backfill', () => {
  let mf: Miniflare;
  afterAll(async () => { await mf?.dispose(); });

  it('turns every existing Spotify link into that contributor\'s source account, and nothing else', async () => {
    mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', d1Databases: ['DB'] });
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await applyMigrations(db, (f) => f < '0013');
    await addContributor(db, 'c-linked', 'sp_matt');
    await addContributor(db, 'c-name-only', null);
    await applyMigrations(db, (f) => f.startsWith('0013'));

    const rows = (await db.prepare('SELECT contributor_id, platform, platform_user_id, role, status, display_name FROM linked_accounts').all()).results;
    expect(rows).toEqual([{
      contributor_id: 'c-linked', platform: 'spotify', platform_user_id: 'sp_matt',
      role: 'source', status: 'active', display_name: 'display-sp_matt',
    }]);
  });
});

describe('linked accounts', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); });
  afterAll(async () => { await rig.mf.dispose(); });
  beforeEach(async () => {
    await resetRig(rig);
    const { keys } = await rig.env.WKRP_KV.list({ prefix: 'wkrp:tokens:' });
    for (const k of keys) await rig.env.WKRP_KV.delete(k.name);
    await addContributor(rig.db, 'c1', 'sp_personal');
    await addContributor(rig.db, 'c2', null);
  });
  afterEach(() => { vi.unstubAllGlobals(); (rig.env as { WKRP_ENCRYPTION_KEY?: string }).WKRP_ENCRYPTION_KEY = undefined; });

  it('refuses one Spotify account on two contributors', async () => {
    await addLinked(rig.db, 'a1', 'c1', 'sp_company', 'mirror');
    await expect(addLinked(rig.db, 'a2', 'c2', 'sp_company', 'mirror')).rejects.toThrow(/UNIQUE/);
  });

  it('refuses a second source account for one contributor, and allows a mirror', async () => {
    await addLinked(rig.db, 'a1', 'c1', 'sp_personal', 'source');
    await expect(addLinked(rig.db, 'a2', 'c1', 'sp_other', 'source')).rejects.toThrow(/UNIQUE/);
    await expect(addLinked(rig.db, 'a3', 'c1', 'sp_company', 'mirror')).resolves.toBeTruthy();
  });

  it('ensureSourceAccount is idempotent and never takes an account from someone else', async () => {
    const first = await ensureSourceAccount(rig.env, 'c1', 'spotify', 'sp_personal', 'Matt');
    const again = await ensureSourceAccount(rig.env, 'c1', 'spotify', 'sp_personal', 'Matt');
    expect(first.ok && again.ok && first.account.id === again.account.id).toBe(true);

    expect(await ensureSourceAccount(rig.env, 'c2', 'spotify', 'sp_personal', null))
      .toEqual({ ok: false, reason: 'linked_elsewhere' });
    expect(await ensureSourceAccount(rig.env, 'c1', 'spotify', 'sp_second', null))
      .toEqual({ ok: false, reason: 'other_source' });
    expect(await listLinkedAccounts(rig.env, 'c2')).toEqual([]);
  });

  it('keeps an existing user\'s tokens where they are, so sync still finds them', async () => {
    const tokens = { access_token: 'at-legacy', refresh_token: 'rt', expires_at: Date.now() + 3_600_000 };
    await storeTokens(rig.env.WKRP_KV, 'c1', tokens);
    const r = await ensureSourceAccount(rig.env, 'c1', 'spotify', 'sp_personal', null);
    if (!r.ok) throw new Error('expected a source account');

    expect(tokenKeyFor(r.account)).toBe('wkrp:tokens:c1');
    expect(await getAccountTokens(rig.env, r.account)).toEqual(tokens);
    expect(await getValidAccessToken(rig.env, 'c1')).toBe('at-legacy');
  });

  it('stores a mirror\'s tokens under its own key, encrypted', async () => {
    (rig.env as { WKRP_ENCRYPTION_KEY?: string }).WKRP_ENCRYPTION_KEY = KEY;
    await addLinked(rig.db, 'm1', 'c1', 'sp_company', 'mirror');
    const [mirror] = (await listLinkedAccounts(rig.env, 'c1')) as LinkedAccount[];
    const tokens = { access_token: 'at-company-secret', refresh_token: 'rt-company', expires_at: 1 };
    await storeAccountTokens(rig.env, mirror, tokens);

    const raw = await rig.env.WKRP_KV.get('wkrp:tokens:la:m1');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('at-company-secret');
    expect(raw).not.toContain('rt-company');
    expect(await rig.env.WKRP_KV.get('wkrp:tokens:c1')).toBeNull();
    expect(await getAccountTokens(rig.env, mirror)).toEqual(tokens);
  });

  it('records the Spotify account signed in with as the source account', async () => {
    await storeAuthState(rig.env.WKRP_KV, 'state-1', { code_verifier: 'v', name: 'Matt', gen: 'founder' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('accounts.spotify.com/api/token')) {
        return Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer', scope: '' });
      }
      if (url.endsWith('/v1/me')) return Response.json({ id: 'sp_new', display_name: 'New Person' });
      throw new Error(`unexpected fetch ${url}`);
    }));

    const res = await call(rig, 'GET', '/auth/callback?code=c&state=state-1');
    expect(res.status).toBe(302);
    const row = await rig.db.prepare(
      `SELECT l.role, l.platform, c.spotify_user_id FROM linked_accounts l
         JOIN contributors c ON c.id = l.contributor_id WHERE l.platform_user_id = 'sp_new'`,
    ).first();
    expect(row).toEqual({ role: 'source', platform: 'spotify', spotify_user_id: 'sp_new' });
  });

  it('eraseLinkedAccounts removes every linked account and the mirror tokens', async () => {
    await addLinked(rig.db, 's1', 'c1', 'sp_personal', 'source');
    await addLinked(rig.db, 'm1', 'c1', 'sp_company', 'mirror');
    await rig.env.WKRP_KV.put('wkrp:tokens:la:m1', 'sealed-mirror');

    expect(await eraseLinkedAccounts(rig.env, 'c1')).toBe(2);
    expect(await listLinkedAccounts(rig.env, 'c1')).toEqual([]);
    expect(await rig.env.WKRP_KV.get('wkrp:tokens:la:m1')).toBeNull();
    expect(await eraseLinkedAccounts(rig.env, 'c1')).toBe(0);
  });
});
