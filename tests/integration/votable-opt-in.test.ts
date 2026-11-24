/**
 * "People may vote for me" (profiles-and-voting launch, story 3; migration 0015).
 *
 * Real D1 and KV from Miniflare, the schema from the actual migrations/ files,
 * through the real router. Each `it` is one rule from the design:
 *   - off by default, for existing profiles and new ones
 *   - the owner opts in, which records the date, and only when signed in
 *   - opting in again keeps the first date
 *   - the owner can withdraw, which clears it
 *   - the public profile says yes or no, never the date
 *   - erasure clears it
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { applyMigrations, call, register, resetRig, startRig, type Rig } from '../support/playback-rig';

async function sinceOf(rig: Rig, id: string): Promise<unknown> {
  const row = await rig.db.prepare('SELECT votable_since FROM contributors WHERE id = ?').bind(id).first<{ votable_since: unknown }>();
  return row?.votable_since;
}

async function publicProfile(rig: Rig, id: string): Promise<Record<string, unknown>> {
  const res = await call(rig, 'GET', `/api/contributors/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { contributor: Record<string, unknown> }).contributor;
}

describe('migration 0015', () => {
  let mf: Miniflare;
  afterAll(async () => { await mf?.dispose(); });

  it('leaves every existing profile opted out', async () => {
    mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', d1Databases: ['DB'] });
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await applyMigrations(db, (f) => f < '0015');
    await db.prepare(
      `INSERT INTO contributors (id, name, generation, brand_id, created_at) VALUES ('c-old', 'Old', 'founder', 'wkrp', '2026-11-24T00:00:00Z')`,
    ).run();
    await applyMigrations(db, (f) => f.startsWith('0015'));
    expect(await db.prepare("SELECT votable_since FROM contributors WHERE id = 'c-old'").first()).toEqual({ votable_since: null });
  });
});

describe('people may vote for me', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); });
  afterAll(async () => { await rig.mf.dispose(); });
  beforeEach(async () => { await resetRig(rig); });

  it('is off for a new profile', async () => {
    const me = await register(rig, 'Ada', 'contributor');
    expect(await sinceOf(rig, me.id)).toBeNull();
    expect((await publicProfile(rig, me.id)).votable).toBe(false);
  });

  it('is turned on by its owner, with the date recorded', async () => {
    const me = await register(rig, 'Bo', 'contributor');
    const res = await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: true } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, votable: true });
    expect(await sinceOf(rig, me.id)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('keeps the first date when turned on again', async () => {
    const me = await register(rig, 'Cy', 'contributor');
    await rig.db.prepare("UPDATE contributors SET votable_since = '2026-01-01 00:00:00' WHERE id = ?").bind(me.id).run();
    const res = await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: true } });
    expect(res.status).toBe(200);
    expect(await sinceOf(rig, me.id)).toBe('2026-01-01 00:00:00');
  });

  it('is withdrawn by its owner', async () => {
    const me = await register(rig, 'Dee', 'contributor');
    await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: true } });
    const res = await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: false } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, votable: false });
    expect(await sinceOf(rig, me.id)).toBeNull();
    expect((await publicProfile(rig, me.id)).votable).toBe(false);
  });

  it('cannot be set without signing in, or with a value that is not true or false', async () => {
    const me = await register(rig, 'Eve', 'contributor');
    expect((await call(rig, 'POST', '/api/profile/votable', { json: { votable: true } })).status).toBe(401);
    expect((await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: 'yes' } })).status).toBe(400);
    expect((await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: {} })).status).toBe(400);
    expect(await sinceOf(rig, me.id)).toBeNull();
  });

  it('shows on the public profile as yes or no, never the date', async () => {
    const me = await register(rig, 'Fay', 'contributor');
    // A date that differs from created_at, so the check below can only match it.
    await rig.db.prepare("UPDATE contributors SET votable_since = '2026-01-02 03:04:05' WHERE id = ?").bind(me.id).run();
    const c = await publicProfile(rig, me.id);
    expect(c.votable).toBe(true);
    expect(c).not.toHaveProperty('votable_since');
    expect(JSON.stringify(c)).not.toContain('2026-01-02');
  });

  it('is cleared when the person erases their identity', async () => {
    const me = await register(rig, 'Gil', 'contributor');
    await call(rig, 'POST', '/api/profile/votable', { cookie: me.cookie, json: { votable: true } });
    const res = await call(rig, 'DELETE', `/api/contributors/${me.id}/identity`, { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(await sinceOf(rig, me.id)).toBeNull();
  });
});
