/**
 * Launch switch: Spotify and DJ (owner decision, 2026-11-23; lib/launch-switch.ts).
 *
 * With SPOTIFY_AND_DJ = "off", every Spotify and DJ route answers 404 like a
 * route that does not exist, and pages drop their marked Spotify and DJ links.
 * With it unset, nothing changes. Everything else stays open either way.
 */
import { describe, it, expect } from 'vitest';
import { route } from '../../src/router';
import { handlePages } from '../../src/handlers/pages';
import { isSpotifyOrDjRoute, stripSpotifyAndDj } from '../../src/lib/launch-switch';
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

const DJ = '11111111-1111-4111-8111-111111111111';
const CLOSED: Array<[string, string]> = [
  ['GET', '/auth/start?name=Matt&gen=founder'],
  ['GET', '/auth/callback?code=c&state=s'],
  ['POST', `/spotify/sync/${DJ}`],
  ['POST', '/api/sets'],
  ['POST', `/api/sets/${DJ}/tracks`],
  ['POST', `/api/sets/${DJ}/end`],
  ['POST', '/api/attributions'],
  ['GET', `/dj/${DJ}`],
  ['GET', `/dj/${DJ}/poster`],
  ['GET', `/dj/${DJ}/live`],
  ['GET', `/dj/${DJ}/stats`],
  ['GET', '/dashboard'],
];

function req(method: string, path: string): Request {
  return new Request(`http://localhost:8787${path}`, {
    method,
    headers: method === 'GET' ? {} : { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
}

describe('launch switch off: Spotify and DJ routes are closed', () => {
  for (const [method, path] of CLOSED) {
    it(`${method} ${path.split('?')[0]} answers 404 Not found`, async () => {
      const res = await route(req(method, path), env({ SPOTIFY_AND_DJ: 'off' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, status: 404, error: 'Not found' });
    });
  }
});

describe('launch switch unset: Spotify and DJ routes still reach their handlers', () => {
  for (const [method, path] of CLOSED) {
    it(`${method} ${path.split('?')[0]} is not the closed 404`, async () => {
      const res = await route(req(method, path), env()).catch(() => null);
      // A handler may fail on the empty test bindings; what matters is that
      // the switch did not answer for it.
      if (res) expect(await res.clone().text()).not.toBe(JSON.stringify({ ok: false, status: 404, error: 'Not found' }));
    });
  }
});

describe('the switch closes only Spotify and DJ', () => {
  it.each([
    ['POST', '/auth/register'],
    ['GET', '/auth/session/me'],
    ['POST', '/auth/logout'],
    ['GET', '/auth/lastfm/start'],
    ['POST', `/import/${DJ}`],
    ['GET', '/catalog'],
    ['GET', `/contributor/${DJ}`],
    ['GET', '/api/tracks'],
    ['GET', `/api/events/${DJ}/music`],
    ['GET', `/api/sponsors/${DJ}/report`],
  ])('%s %s stays open', (method, path) => {
    expect(isSpotifyOrDjRoute(method, path)).toBe(false);
  });
});

describe('pages drop their Spotify and DJ links when the switch is off', () => {
  it('the connect page has no Spotify button and no /auth/start link', async () => {
    const res = await handlePages(new Request('http://localhost:8787/'), env({ SPOTIFY_AND_DJ: 'off' }));
    const html = await res.text();
    expect(html).not.toContain('data-testid="btn-connect"');
    expect(html).not.toContain('/auth/start');
    expect(html).not.toContain('Or connect with Spotify');
    expect(html).toContain('btn-bring');
  });

  it('the catalog page never adds the DJ dashboard link', async () => {
    const res = await handlePages(new Request('http://localhost:8787/catalog'), env({ SPOTIFY_AND_DJ: 'off' }));
    expect(await res.text()).not.toContain("'/dashboard'");
  });

  it('with the switch unset, the connect page keeps the Spotify button', async () => {
    const res = await handlePages(new Request('http://localhost:8787/'), env());
    const html = await res.text();
    expect(html).toContain('data-testid="btn-connect"');
    expect(html).toContain('/auth/start');
  });

  it('strips every marked block in markup and in scripts, and nothing else', () => {
    const page = 'a<!-- spotify-dj:start -->X<!-- spotify-dj:end -->b /* spotify-dj:start */Y/* spotify-dj:end */c';
    expect(stripSpotifyAndDj(page)).toBe('ab c');
  });

  it('no template leaves a marker unclosed', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.join(__dirname, '../../src/templates');
    for (const f of fs.readdirSync(dir)) {
      const t = fs.readFileSync(path.join(dir, f), 'utf-8');
      const starts = t.split('spotify-dj:start').length;
      expect(starts, f).toBe(t.split('spotify-dj:end').length);
      expect(stripSpotifyAndDj(t), f).not.toContain('spotify-dj:');
    }
  });
});
