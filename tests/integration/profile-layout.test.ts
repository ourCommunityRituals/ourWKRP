/**
 * The self-serve skin editor's API (GET/PUT /api/profile/layout, migrations 0016 and 0017).
 *
 * Real D1 and KV from Miniflare, the schema from the actual migrations/ files,
 * through the real router. Each `it` is one rule:
 *   - a profile starts on the standard skin
 *   - the owner saves a skin file; only the arrangement is stored, not notes
 *   - a bad file is refused with plain problems, and nothing changes
 *   - only the signed-in owner can read or change it
 *   - the public profile carries the checked arrangement, never stored text
 *   - erasure clears it
 *   - the standard skin is free; any other skin needs the custom-looks add-on
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, register, resetRig, startRig, type Rig } from '../support/playback-rig';
import { route } from '../../src/router';

const ADMIN = 'test-admin-token-long-enough-0123456789';

/** The custom-looks add-on, through the real admin route. */
async function grantSkins(rig: Rig, id: string, on = true): Promise<Response> {
  return route(new Request('http://localhost:8787/admin/skins/grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ contributorId: id, on }),
  }), rig.env);
}

const SKIN = '---\nsurface: profile\nskin: custom\ncolumns: 2\norder: communities, stats, domains, voting\nwide: communities\n---\nPrivate note: do not store me.\n';

async function stored(rig: Rig, id: string): Promise<string | null> {
  const row = await rig.db.prepare('SELECT profile_layout FROM contributors WHERE id = ?').bind(id).first<{ profile_layout: string | null }>();
  return row?.profile_layout ?? null;
}

describe('profile skin', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); (rig.env as unknown as Record<string, string>).WKRP_ADMIN_TOKEN = ADMIN; });
  afterAll(async () => { await rig.mf.dispose(); });
  beforeEach(async () => { await resetRig(rig); });

  it('starts on the standard skin', async () => {
    const me = await register(rig, 'Ada', 'contributor');
    const res = await call(rig, 'GET', '/api/profile/layout', { cookie: me.cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layout: { skin: string }; markdown: string; options: { parts: string[] } };
    expect(body.layout.skin).toBe('standard');
    expect(body.markdown).toMatch(/^---\nsurface: profile\nskin: standard\n/);
    expect(body.options.parts).toEqual(['stats', 'domains', 'voting', 'communities']);
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('saves the arrangement from a skin file, without its notes', async () => {
    const me = await register(rig, 'Bo', 'contributor');
    await grantSkins(rig, me.id);
    const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layout: unknown; markdown: string };
    expect(body.layout).toEqual({ surface: 'profile', skin: 'custom', columns: 2, order: ['communities', 'stats', 'domains', 'voting'], wide: ['communities'] });
    expect(body.markdown).not.toContain('Private note');
    expect(await stored(rig, me.id)).not.toContain('Private note');

    const again = (await (await call(rig, 'GET', '/api/profile/layout', { cookie: me.cookie })).json()) as { layout: unknown };
    expect(again.layout).toEqual(body.layout);
  });

  it('refuses a file that sets a color or a count, and changes nothing', async () => {
    const me = await register(rig, 'Cy', 'contributor');
    for (const extra of ['color: #ffff00', 'show_counts: yes']) {
      const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN.replace('wide: communities', `wide: communities\n${extra}`) } });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; problems: string[] };
      expect(body.ok).toBe(false);
      expect(body.problems).toHaveLength(1);
    }
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('refuses a file that hides a required part', async () => {
    const me = await register(rig, 'Dee', 'contributor');
    const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN.replace('communities, stats, domains, voting', 'communities, stats, domains') } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems.join(' ')).toMatch(/Missing: voting/);
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('lets an entitled person hide an optional part, and the public profile leaves it out', async () => {
    const me = await register(rig, 'Dot', 'contributor');
    const grant = await grantSkins(rig, me.id);
    expect(grant.status).toBe(200);
    const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN.replace('communities, stats, domains, voting\nwide: communities', 'domains, voting\nwide: voting') } });
    expect(res.status).toBe(200);
    const pub = (await (await call(rig, 'GET', `/api/contributors/${me.id}`)).json()) as { layout: { order: string[] } };
    expect(pub.layout.order).toEqual(['domains', 'voting']);
  });

  it('needs a session, and a body with the file as text', async () => {
    const me = await register(rig, 'Eve', 'contributor');
    expect((await call(rig, 'GET', '/api/profile/layout')).status).toBe(401);
    expect((await call(rig, 'PUT', '/api/profile/layout', { json: { markdown: SKIN } })).status).toBe(401);
    expect((await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: {} })).status).toBe(400);
    expect((await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: 'x'.repeat(9000) } })).status).toBe(400);
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('shows on the public profile as the checked arrangement only', async () => {
    const me = await register(rig, 'Fay', 'contributor');
    await grantSkins(rig, me.id);
    await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    const res = await call(rig, 'GET', `/api/contributors/${me.id}`);
    const body = (await res.json()) as { contributor: Record<string, unknown>; layout: { order: string[] } };
    expect(body.layout.order).toEqual(['communities', 'stats', 'domains', 'voting']);
    expect(body.contributor).not.toHaveProperty('profile_layout');
  });

  it('falls back to the standard skin when what is stored no longer passes', async () => {
    const me = await register(rig, 'Gus', 'contributor');
    await grantSkins(rig, me.id);
    await rig.db.prepare('UPDATE contributors SET profile_layout = ? WHERE id = ?')
      .bind(JSON.stringify({ surface: 'profile', skin: 'custom', columns: 2, order: ['stats'], wide: [] }), me.id).run();
    const body = (await (await call(rig, 'GET', `/api/contributors/${me.id}`)).json()) as { layout: { skin: string } };
    expect(body.layout.skin).toBe('standard');
  });

  it('is cleared when the person erases their identity', async () => {
    const me = await register(rig, 'Hal', 'contributor');
    await grantSkins(rig, me.id);
    await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    const res = await call(rig, 'DELETE', `/api/contributors/${me.id}/identity`, { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('saves the free standard skin without the add-on', async () => {
    const me = await register(rig, 'Ivy', 'contributor');
    const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: '---\nsurface: profile\nskin: standard\ncolumns: 1\norder: stats, domains, voting, communities\n---\n' } });
    expect(res.status).toBe(200);
    const got = (await (await call(rig, 'GET', '/api/profile/layout', { cookie: me.cookie })).json()) as { entitled: boolean };
    expect(got.entitled).toBe(false);
  });

  it('refuses any other skin without the add-on, ready-made or custom', async () => {
    const me = await register(rig, 'Jo', 'contributor');
    for (const md of [SKIN, '---\nsurface: profile\nskin: side_by_side\ncolumns: 2\norder: stats, domains, communities, voting\nwide: stats\n---\n']) {
      const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: md } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('Custom looks are an add-on. Ask us to turn them on.');
    }
    expect(await stored(rig, me.id)).toBeNull();
  });

  it('turns on for everyone on a brand that has the add-on', async () => {
    const me = await register(rig, 'Kai', 'contributor');
    await rig.db.prepare("UPDATE brands SET custom_skins = 1 WHERE id = 'wkrp'").run();
    try {
      const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
      expect(res.status).toBe(200);
    } finally {
      await rig.db.prepare("UPDATE brands SET custom_skins = 0 WHERE id = 'wkrp'").run();
    }
  });

  it('shows the standard skin again when the add-on is taken away, keeping the choice', async () => {
    const me = await register(rig, 'Lu', 'contributor');
    await grantSkins(rig, me.id);
    await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    expect((await grantSkins(rig, me.id, false)).status).toBe(200);
    const pub = (await (await call(rig, 'GET', `/api/contributors/${me.id}`)).json()) as { contributor: Record<string, unknown>; layout: { skin: string } };
    expect(pub.layout.skin).toBe('standard');
    expect(pub.contributor).not.toHaveProperty('custom_skins_since');
    expect(pub.contributor).not.toHaveProperty('brand_custom_skins');
    expect(await stored(rig, me.id)).not.toBeNull();
    await grantSkins(rig, me.id, true);
    const back = (await (await call(rig, 'GET', `/api/contributors/${me.id}`)).json()) as { layout: { skin: string } };
    expect(back.layout.skin).toBe('custom');
  });

  it('is granted only with the admin token, and only to someone who exists', async () => {
    const me = await register(rig, 'Max', 'contributor');
    const noToken = await route(new Request('http://localhost:8787/admin/skins/grant', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: me.cookie },
      body: JSON.stringify({ contributorId: me.id, on: true }),
    }), rig.env);
    expect(noToken.status).toBe(401);
    expect((await grantSkins(rig, '11111111-1111-4111-8111-111111111111')).status).toBe(404);
    const row = await rig.db.prepare('SELECT custom_skins_since FROM contributors WHERE id = ?').bind(me.id).first<{ custom_skins_since: unknown }>();
    expect(row?.custom_skins_since).toBeNull();
  });
});
