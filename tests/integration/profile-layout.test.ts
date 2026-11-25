/**
 * The self-serve skin editor's API (GET/PUT /api/profile/layout, migration 0016).
 *
 * Real D1 and KV from Miniflare, the schema from the actual migrations/ files,
 * through the real router. Each `it` is one rule:
 *   - a profile starts on the standard skin
 *   - the owner saves a skin file; only the arrangement is stored, not notes
 *   - a bad file is refused with plain problems, and nothing changes
 *   - only the signed-in owner can read or change it
 *   - the public profile carries the checked arrangement, never stored text
 *   - erasure clears it
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, register, resetRig, startRig, type Rig } from '../support/playback-rig';

const SKIN = '---\nsurface: profile\nskin: custom\ncolumns: 2\norder: communities, stats, domains, voting\nwide: communities\n---\nPrivate note: do not store me.\n';

async function stored(rig: Rig, id: string): Promise<string | null> {
  const row = await rig.db.prepare('SELECT profile_layout FROM contributors WHERE id = ?').bind(id).first<{ profile_layout: string | null }>();
  return row?.profile_layout ?? null;
}

describe('profile skin', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await startRig(); });
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

  it('refuses a file that hides a part', async () => {
    const me = await register(rig, 'Dee', 'contributor');
    const res = await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN.replace('communities, stats, domains, voting', 'stats, domains, voting') } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problems: string[] }).problems.join(' ')).toMatch(/Missing: communities/);
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
    await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    const res = await call(rig, 'GET', `/api/contributors/${me.id}`);
    const body = (await res.json()) as { contributor: Record<string, unknown>; layout: { order: string[] } };
    expect(body.layout.order).toEqual(['communities', 'stats', 'domains', 'voting']);
    expect(body.contributor).not.toHaveProperty('profile_layout');
  });

  it('falls back to the standard skin when what is stored no longer passes', async () => {
    const me = await register(rig, 'Gus', 'contributor');
    await rig.db.prepare('UPDATE contributors SET profile_layout = ? WHERE id = ?')
      .bind(JSON.stringify({ surface: 'profile', skin: 'custom', columns: 2, order: ['stats'], wide: [] }), me.id).run();
    const body = (await (await call(rig, 'GET', `/api/contributors/${me.id}`)).json()) as { layout: { skin: string } };
    expect(body.layout.skin).toBe('standard');
  });

  it('is cleared when the person erases their identity', async () => {
    const me = await register(rig, 'Hal', 'contributor');
    await call(rig, 'PUT', '/api/profile/layout', { cookie: me.cookie, json: { markdown: SKIN } });
    const res = await call(rig, 'DELETE', `/api/contributors/${me.id}/identity`, { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(await stored(rig, me.id)).toBeNull();
  });
});
