/**
 * Integration tests — Flag facets flow (OW-121, HL-P3.2)
 *
 * Drives the real router with real D1 + KV bindings (Miniflare), so a declared
 * facet written in one request is observable by the SELECT behind the next.
 * Schema comes from the actual migrations/ files, so these fail if 0009 drifts
 * from what the handler expects.
 *
 * Scope guard: facets are additive self-description only. Nothing here touches
 * the legal wall, owner_ref, containers, visibility, or a cross-product seam —
 * a person declaring "(domain, depth)" about themselves, and nothing more.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const BASE_URL = 'http://localhost:8787';

const DATA_TABLES = ['flag_facets', 'contributor_roles', 'contributions', 'tracks', 'contributors'];

/** Split a migration file into statements, keeping BEGIN..END blocks intact. */
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
        const msg = String(err);
        if (/already exists|duplicate column/i.test(msg)) continue;
        throw new Error(`Migration ${file} failed:\n${stmt}\n-> ${msg}`);
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

interface ReqOpts {
  cookie?: string;
  json?: unknown;
}

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

async function register(name: string): Promise<{ cookie: string; id: string }> {
  const res = await call('POST', '/auth/register', { json: { name } });
  expect(res.status).toBe(201);
  const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
  const body = await res.json() as { contributor: { id: string } };
  return { cookie, id: body.contributor.id };
}

interface FacetShape { id: string; domain: string; depth: string; created_at: string }

async function getFacets(id: string): Promise<FacetShape[]> {
  const res = await call('GET', `/api/contributors/${id}`);
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean; facets: FacetShape[] };
  return body.facets;
}

describe('OW-121 flag facets flow', () => {
  it('OW-121 | API | POST /api/facets (authenticated) | declares a facet and folds it into the public profile', async () => {
    const { cookie, id } = await register('Facet Fiona');

    const res = await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'lifelong' } });
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; facet: FacetShape };
    expect(body.ok).toBe(true);
    expect(body.facet.domain).toBe('bocce');
    expect(body.facet.depth).toBe('lifelong');

    const facets = await getFacets(id);
    expect(facets).toHaveLength(1);
    expect(facets[0]).toMatchObject({ domain: 'bocce', depth: 'lifelong' });
    expect(facets[0].id).toBeTruthy();
  }, 30000);

  it('OW-121 | API | POST /api/facets (same domain, new depth) | updates depth in place with no duplicate row', async () => {
    const { cookie, id } = await register('Depth Dave');

    const first = await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'newcomer' } });
    expect(first.status).toBe(201);
    const firstId = (await first.json() as { facet: FacetShape }).facet.id;

    const second = await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'hobbyist' } });
    expect(second.status).toBe(200); // update, not create
    const secondId = (await second.json() as { facet: FacetShape }).facet.id;
    expect(secondId).toBe(firstId); // same row

    const facets = await getFacets(id);
    expect(facets).toHaveLength(1); // one relationship to bocce, not two
    expect(facets[0].depth).toBe('hobbyist');

    // Confirm at the storage layer that exactly one row exists.
    const count = await env.WKRP_DB.prepare(
      'SELECT COUNT(*) as c FROM flag_facets WHERE contributor_id = ? AND domain = ?',
    ).bind(id, 'bocce').first<{ c: number }>();
    expect(count!.c).toBe(1);
  }, 30000);

  it('OW-121 | API | POST /api/facets (unauthenticated) | 401 and writes nothing', async () => {
    const res = await call('POST', '/api/facets', { json: { domain: 'bocce', depth: 'lifelong' } });
    expect(res.status).toBe(401);
    const count = await env.WKRP_DB.prepare('SELECT COUNT(*) as c FROM flag_facets').first<{ c: number }>();
    expect(count!.c).toBe(0);
  }, 30000);

  it('OW-121 | API | POST /api/facets (invalid depth) | 400 with a field error', async () => {
    const { cookie } = await register('Bad Depth Bea');
    const res = await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'expert' } });
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; field_errors: Record<string, string[]> };
    expect(body.ok).toBe(false);
    expect(body.field_errors.depth).toBeDefined();
  }, 30000);

  it('OW-121 | API | DELETE /api/facets/:id (owner) | removes the facet from the profile', async () => {
    const { cookie, id } = await register('Owner Olive');
    const created = await call('POST', '/api/facets', { cookie, json: { domain: 'chess', depth: 'dabbler' } });
    const facetId = (await created.json() as { facet: FacetShape }).facet.id;

    const del = await call('DELETE', `/api/facets/${facetId}`, { cookie });
    expect(del.status).toBe(200);
    expect((await del.json() as { removed: string }).removed).toBe(facetId);

    expect(await getFacets(id)).toHaveLength(0);
  }, 30000);

  it('OW-121 | API | DELETE /api/facets/:id (unauthenticated) | 401 and the facet survives', async () => {
    const { cookie, id } = await register('Guard Gary');
    const created = await call('POST', '/api/facets', { cookie, json: { domain: 'chess', depth: 'dabbler' } });
    const facetId = (await created.json() as { facet: FacetShape }).facet.id;

    const del = await call('DELETE', `/api/facets/${facetId}`);
    expect(del.status).toBe(401);
    expect(await getFacets(id)).toHaveLength(1);
  }, 30000);

  it("OW-121 | API | DELETE /api/facets/:id (another contributor's session) | 403 and the facet survives", async () => {
    const alice = await register('Alice');
    const bob = await register('Bob');

    const created = await call('POST', '/api/facets', { cookie: alice.cookie, json: { domain: 'darts', depth: 'lifelong' } });
    const facetId = (await created.json() as { facet: FacetShape }).facet.id;

    const del = await call('DELETE', `/api/facets/${facetId}`, { cookie: bob.cookie });
    expect(del.status).toBe(403);
    expect(await getFacets(alice.id)).toHaveLength(1); // still Alice's
  }, 30000);

  it('OW-121 | API | DELETE /api/contributors/:id/identity (self) | erases the declared facets', async () => {
    const { cookie, id } = await register('Erasing Ed');
    await call('POST', '/api/facets', { cookie, json: { domain: 'bocce', depth: 'lifelong' } });
    await call('POST', '/api/facets', { cookie, json: { domain: 'chess', depth: 'hobbyist' } });

    const erase = await call('DELETE', `/api/contributors/${id}/identity`, { cookie });
    expect(erase.status).toBe(200);

    const count = await env.WKRP_DB.prepare(
      'SELECT COUNT(*) as c FROM flag_facets WHERE contributor_id = ?',
    ).bind(id).first<{ c: number }>();
    expect(count!.c).toBe(0);
  }, 30000);

  it('OW-121 | API | POST /api/facets (domain carrying an XSS payload) | stores it as sanitized data, never markup', async () => {
    const { cookie, id } = await register('XSS Xena');

    const res = await call('POST', '/api/facets', {
      cookie,
      json: { domain: '"><script>alert(1)</script>chess', depth: 'newcomer' },
    });
    expect(res.status).toBe(201);

    const facets = await getFacets(id);
    expect(facets).toHaveLength(1);
    // HTML tags are stripped by the schema; the residue is inert data.
    expect(facets[0].domain).not.toContain('<script>');
    expect(facets[0].domain).not.toContain('</script>');
    expect(typeof facets[0].domain).toBe('string');
  }, 30000);
});
