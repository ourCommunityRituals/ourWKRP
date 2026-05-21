/**
 * Integration tests — Core user flows
 *
 * Automates the manual testing loop (register → session → import → catalog →
 * playlist) end-to-end. Each flow drives the real router with real D1 + KV
 * bindings provided by Miniflare, so an INSERT in one step is observable by a
 * SELECT in the next — the way a mocked D1 cannot validate.
 *
 * Schema is loaded from the actual migrations/ files, so these tests fail if a
 * migration drifts from what the handlers expect.
 *
 * Notes on intentional deviations from a naive reading of the flow spec:
 *   - POST /auth/register requires { name, role, generation } (registerBodySchema
 *     has no defaults). "Defaults to contributor" is exercised by registering a
 *     contributor and asserting the stored role.
 *   - GET /auth/session/me returns the contributor profile (id/name/generation/
 *     brand_id) but not `role`. Role is verified via GET /api/contributors/:id.
 *   - POST /api/playlists takes { name, description? }; tracks are attached via
 *     POST /api/playlists/:id/tracks. Flow 3 does both.
 *   - The /import page gates roles client-side (its "Import Restricted" banner is
 *     always in the served HTML, toggled by JS). Flow 5 therefore asserts the
 *     real server-side gates: playlist-creation role check + import ownership.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const FIXTURE_CSV = readFileSync(join(__dirname, 'fixtures/test-library.csv'), 'utf-8');
const BASE_URL = 'http://localhost:8787';

// Data tables cleared between tests — `brands` is kept (seeded by migration 0005).
const DATA_TABLES = [
  'playlist_tracks', 'playlists', 'set_tracks', 'attributions', 'dj_sets',
  'contributions', 'track_identifiers', 'contributor_roles', 'tracks', 'contributors',
];

/**
 * Split a migration file into individual statements. Splits on `;` but keeps
 * `CREATE TRIGGER ... BEGIN ... END;` blocks intact by tracking BEGIN/END depth.
 */
function splitSqlStatements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');

  const statements: string[] = [];
  let buf = '';
  for (const fragment of noComments.split(';')) {
    buf += (buf ? ';' : '') + fragment;
    const upper = buf.toUpperCase();
    const begins = (upper.match(/\bBEGIN\b/g) ?? []).length;
    const ends = (upper.match(/\bEND\b/g) ?? []).length;
    if (begins <= ends) {
      const trimmed = buf.trim();
      if (trimmed) statements.push(trimmed);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Apply every migration in order. Tolerates idempotent re-definitions. */
async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        const msg = String(err);
        // migrations/0005 re-declares idx_tracks_energy/valence from 0001.
        if (/already exists|duplicate column/i.test(msg)) continue;
        throw new Error(`Migration ${file} failed:\n${stmt}\n→ ${msg}`);
      }
    }
  }
}

async function truncate(db: D1Database): Promise<void> {
  for (const table of DATA_TABLES) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}

let mf: Miniflare;
let env: Env;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Databases: ['WKRP_DB'],
    kvNamespaces: ['WKRP_KV'],
  });
  const db = await mf.getD1Database('WKRP_DB');
  const kv = await mf.getKVNamespace('WKRP_KV');
  await applyMigrations(db as unknown as D1Database);
  env = {
    WKRP_KV: kv,
    WKRP_DB: db,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0-test',
    SPOTIFY_CLIENT_ID: 'test-client-id',
    SPOTIFY_REDIRECT_URI: `${BASE_URL}/auth/callback`,
    APP_URL: BASE_URL,
    LASTFM_API_KEY: '',
    LASTFM_SHARED_SECRET: '',
  } as unknown as Env;
}, 60000);

afterAll(async () => {
  await mf?.dispose();
});

beforeEach(async () => {
  await truncate(env.WKRP_DB);
});

// --- Request helpers ---

interface ReqOpts {
  cookie?: string;
  json?: unknown;
}

/** Drive a request through the real router. */
async function call(method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  return route(new Request(`${BASE_URL}${path}`, { method, headers, body }), env);
}

interface RegisterResult {
  cookie: string;
  contributorId: string;
  body: { ok: boolean; contributor: { id: string; name: string; role: string; generation: string } };
}

/** Register a contributor and return the session cookie + parsed body. */
async function register(
  name: string,
  role = 'contributor',
  generation = 'gen2',
): Promise<RegisterResult> {
  const res = await call('POST', '/auth/register', { json: { name, role, generation } });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('Set-Cookie');
  expect(setCookie).toContain('wkrp_session=');
  const cookie = setCookie!.split(';')[0]; // "wkrp_session=<token>"
  const body = await res.json() as RegisterResult['body'];
  return { cookie, contributorId: body.contributor.id, body };
}

const importBody = { csv: FIXTURE_CSV, source_type: 'liked', source_name: 'Integration Test Library' };

// --- Flows ---

describe('Core user flows', () => {
  it('Flow 1: register → session → role check', async () => {
    const { cookie, contributorId, body } = await register('TestUser', 'contributor', 'gen2');

    // Registration echoes the created contributor with role "contributor".
    expect(body.ok).toBe(true);
    expect(body.contributor.role).toBe('contributor');

    // Session cookie resolves to the contributor profile.
    const sessionRes = await call('GET', '/auth/session/me', { cookie });
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json() as { ok: boolean; contributor: { id: string; name: string } };
    expect(sessionBody.ok).toBe(true);
    expect(sessionBody.contributor.id).toBe(contributorId);
    expect(sessionBody.contributor.name).toBe('TestUser');

    // Role is exposed via the contributor profile endpoint, and defaults to "contributor".
    const profileRes = await call('GET', `/api/contributors/${contributorId}`);
    expect(profileRes.status).toBe(200);
    const profile = await profileRes.json() as { contributor: { role: string }; roles: string[] };
    expect(profile.contributor.role).toBe('contributor');
    expect(profile.roles).toContain('contributor');

    // Contract check: register requires role + generation (no schema defaults).
    const incomplete = await call('POST', '/auth/register', { json: { name: 'NoRole' } });
    expect(incomplete.status).toBe(400);
  }, 30000);

  it('Flow 2: register → import CSV → catalog shows imported tracks', async () => {
    const { cookie, contributorId } = await register('Importer Ivy', 'curator', 'gen2');

    const importRes = await call('POST', `/import/${contributorId}`, { cookie, json: importBody });
    expect(importRes.status).toBe(200);
    const result = await importRes.json() as {
      tracks_new: number; contributions_created: number; errors: string[];
    };
    expect(result.tracks_new).toBe(4);
    expect(result.contributions_created).toBe(4);
    expect(result.errors).toEqual([]);

    const catalogRes = await call('GET', '/api/tracks');
    expect(catalogRes.status).toBe(200);
    const catalog = await catalogRes.json() as { ok: boolean; tracks: Array<{ name: string }> };
    expect(catalog.ok).toBe(true);
    expect(catalog.tracks).toHaveLength(4);
    const names = catalog.tracks.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'Integration Alpha', 'Integration Bravo', 'Integration Charlie', 'Integration Delta',
    ]));
  }, 30000);

  it('Flow 3: register → create playlist → add tracks → verify', async () => {
    const { cookie, contributorId } = await register('Curator Carol', 'curator', 'gen2');

    // Seed the catalog so there are real track IDs to attach.
    await call('POST', `/import/${contributorId}`, { cookie, json: importBody });
    const tracksRes = await call('GET', '/api/tracks');
    const trackIds = (await tracksRes.json() as { tracks: Array<{ id: string }> })
      .tracks.map((t) => t.id);
    expect(trackIds).toHaveLength(4);

    // Create the playlist.
    const createRes = await call('POST', '/api/playlists', {
      cookie,
      json: { name: 'Flow Test Playlist', description: 'built by the integration suite' },
    });
    expect(createRes.status).toBe(201);
    const playlistId = (await createRes.json() as { playlist: { id: string } }).playlist.id;

    // Attach the tracks.
    const addRes = await call('POST', `/api/playlists/${playlistId}/tracks`, {
      cookie,
      json: { track_ids: trackIds },
    });
    expect(addRes.status).toBe(200);
    expect((await addRes.json() as { added: number }).added).toBe(4);

    // Verify the playlist persisted with its tracks.
    const getRes = await call('GET', `/api/playlists/${playlistId}`);
    expect(getRes.status).toBe(200);
    const playlist = (await getRes.json() as {
      playlist: { id: string; name: string; track_count: number; tracks: unknown[] };
    }).playlist;
    expect(playlist.id).toBe(playlistId);
    expect(playlist.name).toBe('Flow Test Playlist');
    expect(playlist.track_count).toBe(4);
    expect(playlist.tracks).toHaveLength(4);
  }, 30000);

  it('Flow 4: anonymous catalog browse works without a session', async () => {
    // Seed the catalog with an authenticated import first.
    const { cookie, contributorId } = await register('Seeder Sam', 'curator', 'gen2');
    await call('POST', `/import/${contributorId}`, { cookie, json: importBody });

    // The catalog API is readable with no cookie.
    const tracksRes = await call('GET', '/api/tracks');
    expect(tracksRes.status).toBe(200);
    expect((await tracksRes.json() as { tracks: unknown[] }).tracks).toHaveLength(4);

    // The catalog page is served as HTML with no cookie.
    const catalogPage = await call('GET', '/catalog');
    expect(catalogPage.status).toBe(200);
    expect(catalogPage.headers.get('Content-Type')).toContain('text/html');
  }, 30000);

  it('Flow 5: role gating — playlist creation + import ownership enforced', async () => {
    const contributor = await register('Reg Contributor', 'contributor', 'gen2');
    const listener = await register('Reg Listener', 'listener', 'gen3');
    const curator = await register('Reg Curator', 'curator', 'gen2');

    // A contributor may import into their OWN library (the import API has no role gate).
    const ownImport = await call('POST', `/import/${contributor.contributorId}`, {
      cookie: contributor.cookie, json: importBody,
    });
    expect(ownImport.status).toBe(200);

    // Import ownership: a user cannot import into someone else's library.
    const crossImport = await call('POST', `/import/${curator.contributorId}`, {
      cookie: listener.cookie, json: importBody,
    });
    expect(crossImport.status).toBe(403);

    // Playlist creation is restricted to founder/curator/dj.
    const contributorPlaylist = await call('POST', '/api/playlists', {
      cookie: contributor.cookie, json: { name: 'Contributor Attempt' },
    });
    expect(contributorPlaylist.status).toBe(403);

    const listenerPlaylist = await call('POST', '/api/playlists', {
      cookie: listener.cookie, json: { name: 'Listener Attempt' },
    });
    expect(listenerPlaylist.status).toBe(403);

    const curatorPlaylist = await call('POST', '/api/playlists', {
      cookie: curator.cookie, json: { name: 'Curator Picks' },
    });
    expect(curatorPlaylist.status).toBe(201);

    // Playlist creation with no session is rejected outright.
    const anonPlaylist = await call('POST', '/api/playlists', { json: { name: 'Anon Attempt' } });
    expect(anonPlaylist.status).toBe(401);

    // The /import page is served to anyone; its role gate is applied client-side.
    const importPage = await call('GET', '/import');
    expect(importPage.status).toBe(200);
    expect(importPage.headers.get('Content-Type')).toContain('text/html');
  }, 30000);
});
