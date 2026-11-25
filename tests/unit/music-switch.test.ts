/**
 * The music switch (OW-224, step 7 of OSE-2222; src/lib/music-switch.ts).
 *
 * With MUSIC_ENABLED = "off", every music route answers the router's own 404,
 * and pages show their music-off blocks instead of their music blocks. With it
 * unset or "on", nothing changes.
 *
 * The route table comes from the router's own header comment (the canonical
 * route table, CLAUDE.md), so a route added there is covered here at once: it
 * is closed by the switch unless it is named in KEPT below. A music route left
 * out of the switch fails this file.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { route } from '../../src/router';
import { handlePages } from '../../src/handlers/pages';
import { isMusicPath, musicOff, applyMusicSwitch } from '../../src/lib/music-switch';
import type { Env } from '../../src/types';

function env(extra: Partial<Env> = {}): Env {
  return {
    WKRP_KV: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    WKRP_DB: {} as D1Database,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test-client-id',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    LASTFM_API_KEY: '',
    LASTFM_SHARED_SECRET: '',
    ...extra,
  } as Env;
}

const OFF = { MUSIC_ENABLED: 'off' } as const;
const CLOSED_BODY = JSON.stringify({ ok: false, status: 404, error: 'Not found' });
const ID = '11111111-1111-4111-8111-111111111111';

/** Every route in the router's header comment, as [method, path template]. */
function routerTable(): Array<[string, string]> {
  const src = fs.readFileSync(path.join(__dirname, '../../src/router.ts'), 'utf-8');
  const header = src.slice(0, src.indexOf('*/'));
  const rows: Array<[string, string]> = [];
  for (const line of header.split('\n')) {
    const m = line.match(/^\s*\*\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s/);
    if (m) rows.push([m[1], m[2]]);
  }
  return rows;
}

/** A concrete path for a template: every :param becomes a valid id. */
function concrete(template: string): string {
  return template.replace(/:slug\b/, 'someone').replace(/:[A-Za-z]+/g, ID);
}

/**
 * The routes that stay on with music off (OW-224 "Kept on"): sign-up by name,
 * sessions, profiles and /c/:slug, facets, erasure, health and /ui.css, plus
 * the contributor and community directory a profile reads.
 */
const KEPT = new Set([
  'GET /health',
  'GET /ui.css',
  'GET /',
  'POST /auth/register',
  'POST /auth/logout',
  'GET /auth/session/me',
  'POST /admin/roles/grant',
  'GET /api/contributors',
  'GET /api/contributors/:id',
  'GET /api/contributors/:id/brands',
  'DELETE /api/contributors/:id/identity',
  'GET /contributor/:id',
  'GET /c/:slug',
  'POST /api/profile/slug',
  'POST /api/profile/type',
  'POST /api/profile/votable',
  'GET /api/brands',
  'POST /api/facets',
  'DELETE /api/facets/:id',
]);

function req(method: string, p: string): Request {
  return new Request(`http://localhost:8787${p}`, {
    method,
    headers: method === 'GET' ? {} : { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
}

const TABLE = routerTable();
const MUSIC = TABLE.filter(([m, p]) => !KEPT.has(`${m} ${p}`));

describe('the router table this file reads', () => {
  it('is long enough to be the real table', () => {
    expect(TABLE.length).toBeGreaterThan(45);
  });

  it('names every kept route, so KEPT cannot hold a stale entry', () => {
    const listed = new Set(TABLE.map(([m, p]) => `${m} ${p}`));
    for (const k of KEPT) expect(listed.has(k), k).toBe(true);
  });
});

describe('with music off, each music route answers 404', () => {
  it.each(MUSIC)('%s %s', async (method, template) => {
    const res = await route(req(method, concrete(template)), env(OFF));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(CLOSED_BODY);
  });
});

describe('with music off, the kept routes are not closed by the switch', () => {
  it.each(TABLE.filter(([m, p]) => KEPT.has(`${m} ${p}`)))('%s %s', (_method, template) => {
    expect(isMusicPath(concrete(template))).toBe(false);
  });
});

describe('with music on or unset, music routes still reach their handlers', () => {
  for (const setting of [{}, { MUSIC_ENABLED: 'on' }]) {
    it.each(MUSIC)(`%s %s (${JSON.stringify(setting)})`, async (method, template) => {
      const res = await route(req(method, concrete(template)), env(setting)).catch(() => null);
      // A handler may fail on the empty test bindings; what matters is that
      // the switch did not answer for it.
      if (res) expect(await res.clone().text()).not.toBe(CLOSED_BODY);
    });
  }
});

describe('the setting', () => {
  it('is off only for the exact value "off"', () => {
    expect(musicOff({ MUSIC_ENABLED: 'off' })).toBe(true);
    expect(musicOff({ MUSIC_ENABLED: 'on' })).toBe(false);
    expect(musicOff({})).toBe(false);
  });

  it('closes any method on a music path, not only the listed one', async () => {
    const res = await route(req('PUT', `/api/playlists/${ID}/tracks`), env(OFF));
    expect(await res.text()).toBe(CLOSED_BODY);
  });
});

describe('pages follow the switch', () => {
  it('with music off, the connect page offers a profile, not music, Spotify or the catalog', async () => {
    const html = await (await handlePages(new Request('http://localhost:8787/'), env(OFF))).text();
    expect(html).toContain('data-testid="btn-profile"');
    expect(html).not.toContain('data-testid="btn-bring"');
    expect(html).not.toContain('data-testid="btn-browse"');
    expect(html).not.toContain('data-testid="btn-connect"');
    expect(html).not.toContain('/auth/start');
    expect(html).not.toContain('/catalog');
    expect(html).not.toContain("'/import'");
  });

  it('with music on, the connect page keeps music, Spotify and the catalog', async () => {
    const html = await (await handlePages(new Request('http://localhost:8787/'), env())).text();
    expect(html).toContain('data-testid="btn-bring"');
    expect(html).toContain('data-testid="btn-browse"');
    expect(html).toContain('data-testid="btn-connect"');
    expect(html).not.toContain('data-testid="btn-profile"');
  });

  it('with music off, the profile page links no music page and calls no music API', async () => {
    const html = await (await handlePages(new Request(`http://localhost:8787/contributor/${ID}`), env({
      ...OFF,
      WKRP_DB: { prepare: () => ({ bind: () => ({ first: async () => null }), first: async () => null }) } as unknown as D1Database,
    }))).text();
    for (const p of ['/catalog', '/create', '/import', '/dashboard', '/portfolio', '/api/portfolio']) {
      expect(html, p).not.toContain(p);
    }
    for (const id of ['stat-tracks', 'stat-playlists', 'genres-section', 'playlists-section', 'portfolio-section', 'attribution-section', 'bottom-nav']) {
      expect(html, id).not.toContain(`id="${id}"`);
    }
    expect(html).toContain('id="facets-section"');
    expect(html).toContain('id="vote-optin-section"');
  });

  it('strips each kind of marked block, in markup and in scripts, and nothing else', () => {
    const page =
      'a<!-- music:start -->M<!-- music:end -->b<!-- music-off:start -->O<!-- music-off:end -->c' +
      '/* music:start */m/* music:end */d/* music-off:start */o/* music-off:end */e';
    expect(applyMusicSwitch(page, true)).toBe('abOcdoe');
    expect(applyMusicSwitch(page, false)).toBe('aMbcmde');
  });

  it('no template leaves a marker unclosed or a marker behind', () => {
    const dir = path.join(__dirname, '../../src/templates');
    for (const f of fs.readdirSync(dir)) {
      const t = fs.readFileSync(path.join(dir, f), 'utf-8');
      for (const kind of ['music', 'music-off']) {
        const opens = t.match(new RegExp(`(<!-- |/\\* )${kind}:start`, 'g'))?.length ?? 0;
        const closes = t.match(new RegExp(`(<!-- |/\\* )${kind}:end`, 'g'))?.length ?? 0;
        expect(opens, `${f} ${kind}`).toBe(closes);
      }
      expect(applyMusicSwitch(t, true), f).not.toMatch(/music(-off)?:(start|end)/);
      expect(applyMusicSwitch(t, false), f).not.toMatch(/music(-off)?:(start|end)/);
    }
  });
});
