/**
 * Integration — with music off, the named side still works (OW-224).
 *
 * Drives the real router against real D1 + KV (Miniflare, every migration
 * applied) with MUSIC_ENABLED = "off", the value staging and production carry.
 * One person signs up by name, reads their session, sees their profile, claims
 * a slug and opens it, sets a profile type, declares and removes a facet, and
 * erases themselves. Music routes on the same rig answer the router's 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const BASE_URL = 'http://localhost:8787';

/** Split a migration file into statements, keeping BEGIN...END blocks intact. */
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

async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        if (/already exists|duplicate column/i.test(String(err))) continue;
        throw new Error(`Migration ${file} failed:\n${stmt}\n→ ${String(err)}`);
      }
    }
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
    MUSIC_ENABLED: 'off',
  } as unknown as Env;
}, 60000);

afterAll(async () => {
  await mf?.dispose();
});

async function call(method: string, path: string, opts: { cookie?: string; json?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '10.9.0.1' };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  return route(new Request(`${BASE_URL}${path}`, { method, headers, body }), env);
}

describe('with music off, sign-up, profile, slug, facets and erasure still work', () => {
  it('one person goes from sign-up to erasure without touching music', async () => {
    // Sign-up by name.
    const reg = await call('POST', '/auth/register', { json: { name: 'Nia', profile_type: 'artist' } });
    expect(reg.status).toBe(201);
    const cookie = reg.headers.get('Set-Cookie')!.split(';')[0];
    const id = ((await reg.json()) as { contributor: { id: string } }).contributor.id;

    // Session.
    const me = await call('GET', '/auth/session/me', { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { contributor: { id: string } }).contributor.id).toBe(id);

    // Profile: JSON and page.
    const profile = await call('GET', `/api/contributors/${id}`);
    expect(profile.status).toBe(200);
    expect(((await profile.json()) as { contributor: { name: string } }).contributor.name).toBe('Nia');
    const page = await call('GET', `/contributor/${id}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-testid="profile-view"');

    // Slug, then the page by slug.
    const slug = await call('POST', '/api/profile/slug', { cookie, json: { slug: 'nia' } });
    expect(slug.status).toBe(200);
    expect((await call('GET', '/c/nia')).status).toBe(200);

    // Profile type.
    expect((await call('POST', '/api/profile/type', { cookie, json: { profile_type: 'sports' } })).status).toBe(200);

    // Facets: declare, then remove.
    const facet = await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'lifelong' } });
    expect(facet.status).toBe(201);
    const facetId = ((await facet.json()) as { facet: { id: string } }).facet.id;
    expect((await call('DELETE', `/api/facets/${facetId}`, { cookie })).status).toBe(200);

    // Music is closed on the same rig.
    expect((await call('GET', '/api/tracks')).status).toBe(404);
    expect((await call('POST', '/api/portfolio', { cookie, json: { url: 'https://open.spotify.com/playlist/x' } })).status).toBe(404);

    // Erasure.
    const erase = await call('DELETE', `/api/contributors/${id}/identity`, { cookie });
    expect(erase.status).toBe(200);
    // Erasure tombstones the row (lib/erasure.ts): the name is gone and the slug freed.
    const after = await call('GET', `/api/contributors/${id}`);
    if (after.status === 200) {
      expect(((await after.json()) as { contributor: { name: string } }).contributor.name).not.toBe('Nia');
    }
    expect((await call('GET', '/c/nia')).status).toBe(404);
  }, 30000);
});
