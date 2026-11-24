/**
 * Profile type (profiles-and-voting launch, story 2; migration 0014).
 *
 * Real D1 and KV from Miniflare, the schema from the actual migrations/ files,
 * through the real router. Each `it` is one rule from the design:
 *   - a type is empty or one of the launch types (artist, sports)
 *   - existing profiles keep working with no type
 *   - a person can pick a type at sign-up, or skip it
 *   - a person can change or clear their own type later, and only when signed in
 *   - the public profile shows the type
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { applyMigrations, call, register, resetRig, startRig, type Rig } from '../support/playback-rig';

async function typeOf(rig: Rig, id: string): Promise<unknown> {
  const row = await rig.db.prepare('SELECT profile_type FROM contributors WHERE id = ?').bind(id).first<{ profile_type: unknown }>();
  return row?.profile_type;
}

describe('migration 0014', () => {
  let mf: Miniflare;
  afterAll(async () => { await mf?.dispose(); });

  it('leaves existing profiles with no type, and refuses a type outside the launch list', async () => {
    mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', d1Databases: ['DB'] });
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await applyMigrations(db, (f) => f < '0014');
    await db.prepare(
      `INSERT INTO contributors (id, name, generation, brand_id, created_at) VALUES ('c-old', 'Old', 'founder', 'wkrp', '2026-11-24T00:00:00Z')`,
    ).run();
    await applyMigrations(db, (f) => f.startsWith('0014'));

    expect(await db.prepare("SELECT profile_type FROM contributors WHERE id = 'c-old'").first()).toEqual({ profile_type: null });
    await expect(db.prepare("UPDATE contributors SET profile_type = 'dj' WHERE id = 'c-old'").run()).rejects.toThrow(/CHECK/);
    await expect(db.prepare("UPDATE contributors SET profile_type = 'artist' WHERE id = 'c-old'").run()).resolves.toBeTruthy();
  });
});

describe('profile type', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); });
  afterAll(async () => { await rig.mf.dispose(); });
  beforeEach(async () => { await resetRig(rig); });

  it('is picked at sign-up', async () => {
    const res = await call(rig, 'POST', '/auth/register', { json: { name: 'Ada', profile_type: 'artist' } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contributor: { id: string; profile_type: string } };
    expect(body.contributor.profile_type).toBe('artist');
    expect(await typeOf(rig, body.contributor.id)).toBe('artist');
  });

  it('can be skipped at sign-up', async () => {
    const res = await call(rig, 'POST', '/auth/register', { json: { name: 'Bo' } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contributor: { id: string; profile_type: unknown } };
    expect(body.contributor.profile_type).toBeNull();
    expect(await typeOf(rig, body.contributor.id)).toBeNull();
  });

  it('refuses a type outside the launch list at sign-up, and creates nobody', async () => {
    const res = await call(rig, 'POST', '/auth/register', { json: { name: 'Cy', profile_type: 'dj' } });
    expect(res.status).toBe(400);
    expect(await rig.db.prepare('SELECT COUNT(*) AS n FROM contributors').first()).toEqual({ n: 0 });
  });

  it('is changed and cleared by its owner', async () => {
    const me = await register(rig, 'Dee', 'contributor');
    let res = await call(rig, 'POST', '/api/profile/type', { cookie: me.cookie, json: { profile_type: 'sports' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, profile_type: 'sports' });
    expect(await typeOf(rig, me.id)).toBe('sports');

    res = await call(rig, 'POST', '/api/profile/type', { cookie: me.cookie, json: { profile_type: null } });
    expect(res.status).toBe(200);
    expect(await typeOf(rig, me.id)).toBeNull();
  });

  it('cannot be set without signing in, or to a type outside the list', async () => {
    const me = await register(rig, 'Eve', 'contributor');
    expect((await call(rig, 'POST', '/api/profile/type', { json: { profile_type: 'artist' } })).status).toBe(401);
    expect((await call(rig, 'POST', '/api/profile/type', { cookie: me.cookie, json: { profile_type: 'dj' } })).status).toBe(400);
    expect(await typeOf(rig, me.id)).toBeNull();
  });

  it('shows on the public profile', async () => {
    const res = await call(rig, 'POST', '/auth/register', { json: { name: 'Fay', profile_type: 'sports' } });
    const { contributor } = (await res.json()) as { contributor: { id: string } };
    const profile = await call(rig, 'GET', `/api/contributors/${contributor.id}`);
    expect(profile.status).toBe(200);
    expect(((await profile.json()) as { contributor: { profile_type: string } }).contributor.profile_type).toBe('sports');
  });
});
