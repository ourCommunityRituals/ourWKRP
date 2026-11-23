/**
 * Test rig for playback events (OW-219): a real D1 + KV from Miniflare, the
 * schema applied from the actual migrations/ files, and the real router.
 *
 * Shared by the playback-event suites in tests/integration, tests/security
 * and tests/contract, so each of them drives the same handlers against the
 * same schema (an INSERT in one step is seen by a SELECT in the next, which a
 * mocked D1 cannot show).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
export const BASE_URL = 'http://localhost:8787';

// Children before parents, so foreign keys never block the reset.
const DATA_TABLES = [
  'playback_events', 'set_tracks', 'attributions', 'dj_sets', 'flag_facets',
  'preferred_playlists', 'linked_accounts', 'playlist_tracks', 'playlists', 'contributions',
  'track_identifiers', 'contributor_roles', 'tracks', 'contributors',
];

/** Split a migration into statements, keeping CREATE TRIGGER ... END; whole. */
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

/**
 * Apply the migrations in order. `only` limits the run to the files it
 * accepts, so a test can stop before a migration, seed rows, then apply it.
 */
export async function applyMigrations(db: D1Database, only: (file: string) => boolean = () => true): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().filter(only);
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        throw new Error(`Migration ${file} failed:\n${stmt}\n→ ${String(err)}`);
      }
    }
  }
}

export interface Rig {
  mf: Miniflare;
  env: Env;
  db: D1Database;
}

export async function startRig(): Promise<Rig> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Databases: ['WKRP_DB'],
    kvNamespaces: ['WKRP_KV'],
  });
  const db = (await mf.getD1Database('WKRP_DB')) as unknown as D1Database;
  const kv = await mf.getKVNamespace('WKRP_KV');
  await applyMigrations(db);
  const env = {
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
  return { mf, env, db };
}

export async function resetRig(rig: Rig): Promise<void> {
  for (const table of DATA_TABLES) await rig.db.prepare(`DELETE FROM ${table}`).run();
  // Every request in the rig comes from one caller, so the per-minute
  // rate-limit windows (lib/rate-limit.ts, kept in KV here) would carry from
  // one test into the next. Each test starts with fresh windows.
  const { keys } = await rig.env.WKRP_KV.list({ prefix: 'wkrp:rl:' });
  for (const key of keys) await rig.env.WKRP_KV.delete(key.name);
}

export interface CallOpts {
  cookie?: string;
  json?: unknown;
  base?: string;
}

/** Drive one request through the real router. */
export async function call(rig: Rig, method: string, path: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const base = opts.base ?? BASE_URL;
  return route(new Request(`${base}${path}`, { method, headers, body }), rig.env);
}

export interface Person {
  cookie: string;
  id: string;
}

/**
 * Register someone with a name, then grant `dj` out of band when asked (self
 * registration mints only unprivileged roles; the role is read from D1 per
 * request, so the issued session picks the grant up).
 */
export async function register(rig: Rig, name: string, role: 'dj' | 'listener' | 'contributor'): Promise<Person> {
  const httpRole = role === 'dj' ? 'contributor' : role;
  const res = await call(rig, 'POST', '/auth/register', { json: { name, role: httpRole, generation: 'gen2' } });
  if (res.status !== 201) throw new Error(`register ${name}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
  const id = ((await res.json()) as { contributor: { id: string } }).contributor.id;
  if (role === 'dj') {
    await rig.db.prepare("UPDATE contributors SET role = 'dj' WHERE id = ?").bind(id).run();
  }
  return { cookie, id };
}

/** Put neutral, made-up tracks in the catalog. */
export async function seedTracks(rig: Rig, ids: string[]): Promise<void> {
  for (const id of ids) {
    await rig.db.prepare(
      `INSERT INTO tracks (id, name, artist, album, image_url, genre, created_at)
       VALUES (?, ?, ?, ?, ?, 'test', datetime('now'))`,
    ).bind(id, `Song ${id}`, `Artist ${id}`, `Album ${id}`, `https://img.example/${id}.jpg`).run();
  }
}

export async function startSet(rig: Rig, dj: Person): Promise<string> {
  const res = await call(rig, 'POST', '/api/sets', { cookie: dj.cookie, json: { venue_name: 'Test Room' } });
  if (res.status !== 201) throw new Error(`start set: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { set: { id: string } }).set.id;
}

export async function logTrack(rig: Rig, dj: Person, setId: string, trackId: string): Promise<string> {
  const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: dj.cookie, json: { track_id: trackId } });
  if (res.status !== 200) throw new Error(`log track: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { playback_event: { id: string } }).playback_event.id;
}

export interface PlaybackRow {
  id: string;
  set_id: string;
  track_id: string;
  brand_id: string;
  started_at: string;
  ended_at: string | null;
}

export async function playbackRows(rig: Rig, setId?: string): Promise<PlaybackRow[]> {
  const stmt = setId
    ? rig.db.prepare('SELECT * FROM playback_events WHERE set_id = ? ORDER BY rowid').bind(setId)
    : rig.db.prepare('SELECT * FROM playback_events ORDER BY rowid');
  return (await stmt.all<PlaybackRow>()).results;
}
