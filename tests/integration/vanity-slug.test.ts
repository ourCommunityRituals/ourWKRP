/**
 * Integration tests — Vanity slugs and server-rendered OG meta (OW-122, HL-P3.3)
 *
 * Drives the real router against real D1 + KV (Miniflare) with the actual
 * migrations applied, so the (brand_id, slug) UNIQUE index from migration 0010
 * is the thing under test rather than a mock of it.
 *
 * The load-bearing assertion is that /c/:slug returns *bytes* containing the OG
 * tags and the resolved contributor id. OpenGraph crawlers do not run
 * JavaScript, so anything only a browser would produce does not count.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const BASE_URL = 'http://localhost:8787';
const BRAND_HOST = 'https://bronzeville.ourwkrp.com';

const DATA_TABLES = ['contributor_roles', 'contributions', 'contributors'];

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
        const msg = String(err);
        if (/already exists|duplicate column/i.test(msg)) continue;
        throw new Error(`Migration ${file} failed:\n${stmt}\n→ ${msg}`);
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

  // A second brand, so cross-brand slug behaviour is exercised against a real
  // brands row (distinct name proves the OG block is brand-scoped too).
  await (db as unknown as D1Database).prepare(
    "INSERT OR IGNORE INTO brands (id, name, subdomain) VALUES ('bronzeville', 'Bronzeville', 'bronzeville')",
  ).run();

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

// Rate-limit buckets are keyed by client IP and live in KV across the whole
// file. Give each test its own IP so one test's requests can never exhaust
// another's budget.
let clientIp = 0;
beforeEach(async () => {
  clientIp += 1;
  for (const table of DATA_TABLES) {
    await env.WKRP_DB.prepare(`DELETE FROM ${table}`).run();
  }
});

interface ReqOpts {
  cookie?: string;
  json?: unknown;
  origin?: string;
}

/** Drive a request through the real router. */
async function call(method: string, path: string, opts: ReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': `10.0.0.${clientIp}` };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const base = opts.origin ?? BASE_URL;
  return route(new Request(`${base}${path}`, { method, headers, body }), env);
}

interface Registered {
  cookie: string;
  id: string;
}

/** Register a contributor on `origin`'s brand and return its session + id. */
async function register(name: string, origin = BASE_URL): Promise<Registered> {
  // Self-service register only mints unprivileged roles (F1); slug claiming is
  // not role-gated, so a contributor session is all this helper needs.
  const res = await call('POST', '/auth/register', {
    json: { name, role: 'contributor', generation: 'gen2' },
    origin,
  });
  expect(res.status).toBe(201);
  const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
  const body = await res.json() as { contributor: { id: string } };
  return { cookie, id: body.contributor.id };
}

async function claimSlug(cookie: string, slug: string, origin = BASE_URL): Promise<Response> {
  return call('POST', '/api/profile/slug', { cookie, json: { slug }, origin });
}

describe('vanity slug + server-rendered OG meta (OW-122)', () => {
  describe('POST /api/profile/slug — claiming', () => {
    it('claims an unused slug and returns it', async () => {
      const matt = await register('Matt');
      const res = await claimSlug(matt.cookie, 'matt');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; slug: string; slug_locked: number };
      expect(body.ok).toBe(true);
      expect(body.slug).toBe('matt');
      // Mirrors OSE: the lock is a lifecycle flag, never set by a first claim.
      expect(body.slug_locked).toBe(0);
    });

    it('persists the slug on the contributor row', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      const row = await env.WKRP_DB.prepare(
        'SELECT slug, slug_locked FROM contributors WHERE id = ?',
      ).bind(matt.id).first<{ slug: string; slug_locked: number }>();
      expect(row?.slug).toBe('matt');
      expect(row?.slug_locked).toBe(0);
    });

    it('rejects a duplicate slug within the same brand with 409 (UNIQUE index is the arbiter)', async () => {
      const matt = await register('Matt');
      const other = await register('Other');
      expect((await claimSlug(matt.cookie, 'shared')).status).toBe(200);

      const res = await claimSlug(other.cookie, 'shared');
      expect(res.status).toBe(409);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/already taken/i);
    });

    it('allows the same slug in a DIFFERENT brand (uniqueness is per brand_id)', async () => {
      const wkrpMatt = await register('Matt');
      const bronzevilleMatt = await register('Matt', BRAND_HOST);
      expect((await claimSlug(wkrpMatt.cookie, 'matt')).status).toBe(200);
      expect((await claimSlug(bronzevilleMatt.cookie, 'matt', BRAND_HOST)).status).toBe(200);

      const rows = await env.WKRP_DB.prepare(
        "SELECT brand_id FROM contributors WHERE slug = 'matt' ORDER BY brand_id",
      ).all<{ brand_id: string }>();
      expect(rows.results.map((r) => r.brand_id)).toEqual(['bronzeville', 'wkrp']);
    });

    it('rejects a malformed slug with 400 before touching the database', async () => {
      const matt = await register('Matt');
      const res = await claimSlug(matt.cookie, 'Not A Slug');
      expect(res.status).toBe(400);
    });

    it('rejects a reserved slug with 400 (a contributor cannot claim a route name)', async () => {
      const matt = await register('Matt');
      const res = await claimSlug(matt.cookie, 'api');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/reserved/i);
    });
  });

  describe('POST /api/profile/slug — changing and lock semantics', () => {
    it('lets an unlocked owner change their slug and frees the old one', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      expect((await claimSlug(matt.cookie, 'dj-matt')).status).toBe(200);

      expect((await call('GET', '/c/dj-matt')).status).toBe(200);
      // The abandoned slug is genuinely released, not merely shadowed.
      expect((await call('GET', '/c/matt')).status).toBe(404);
    });

    it('rejects a change with 403 once slug_locked is set (OSE precedent: URL already in print)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      await env.WKRP_DB.prepare(
        'UPDATE contributors SET slug_locked = 1 WHERE id = ?',
      ).bind(matt.id).run();

      const res = await claimSlug(matt.cookie, 'dj-matt');
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/locked/i);

      // The locked URL keeps working.
      expect((await call('GET', '/c/matt')).status).toBe(200);
    });

    it('treats re-claiming your own locked slug as an idempotent success (not a change)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      await env.WKRP_DB.prepare(
        'UPDATE contributors SET slug_locked = 1 WHERE id = ?',
      ).bind(matt.id).run();

      const res = await claimSlug(matt.cookie, 'matt');
      expect(res.status).toBe(200);
    });

    it('writes an audit event for a successful claim', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      const row = await env.WKRP_DB.prepare(
        "SELECT action, outcome, actor_id FROM audit_events WHERE action = 'profile.slug.claim' ORDER BY ts DESC",
      ).first<{ action: string; outcome: string; actor_id: string }>();
      expect(row?.outcome).toBe('success');
      expect(row?.actor_id).toBe(matt.id);
    });

    it('writes a denied audit event when the lock blocks a change', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      await env.WKRP_DB.prepare('UPDATE contributors SET slug_locked = 1 WHERE id = ?')
        .bind(matt.id).run();
      await claimSlug(matt.cookie, 'dj-matt');

      const row = await env.WKRP_DB.prepare(
        "SELECT outcome FROM audit_events WHERE action = 'profile.slug.claim' AND outcome = 'denied'",
      ).first<{ outcome: string }>();
      expect(row?.outcome).toBe('denied');
    });
  });

  describe('GET /c/:slug — serving the profile page', () => {
    it('serves the profile page HTML for a claimed slug', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const res = await call('GET', '/c/matt');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('data-testid="profile-view"');
    });

    it('stamps the resolved contributor id onto <body> so the client script can fetch without the id in the URL', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const html = await (await call('GET', '/c/matt')).text();
      expect(html).toContain(`<body data-contributor-id="${matt.id}">`);
    });

    it('injects OG meta into the served bytes (crawlers do not run JavaScript)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const html = await (await call('GET', '/c/matt')).text();
      expect(html).toContain('<meta property="og:title" content="Matt — WKRP">');
      expect(html).toContain('<meta property="og:type" content="profile">');
      expect(html).toContain('<meta name="twitter:card" content="summary">');
      expect(html).toContain('<meta property="og:description"');
      expect(html).toContain('<meta property="og:site_name" content="WKRP">');
    });

    it('places the OG block inside <head>', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const html = await (await call('GET', '/c/matt')).text();
      const headEnd = html.indexOf('</head>');
      expect(headEnd).toBeGreaterThan(-1);
      expect(html.indexOf('<meta property="og:title"')).toBeLessThan(headEnd);
      expect(html.indexOf('<link rel="canonical"')).toBeLessThan(headEnd);
    });

    it('points canonical and og:url at the vanity URL when a slug exists', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const html = await (await call('GET', '/c/matt')).text();
      expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/c/matt">`);
      expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/c/matt">`);
    });

    it('omits og:image when the brand has no logo (better no preview image than a broken one)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');

      const html = await (await call('GET', '/c/matt')).text();
      expect(html).not.toContain('og:image');
    });

    it('emits an absolute og:image when the brand has a logo_url', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      await env.WKRP_DB.prepare("UPDATE brands SET logo_url = '/logo.png' WHERE id = 'wkrp'").run();
      try {
        const html = await (await call('GET', '/c/matt')).text();
        expect(html).toContain(`<meta property="og:image" content="${BASE_URL}/logo.png">`);
      } finally {
        await env.WKRP_DB.prepare("UPDATE brands SET logo_url = NULL WHERE id = 'wkrp'").run();
      }
    });

    it('returns 404 for a slug nobody has claimed', async () => {
      const res = await call('GET', '/c/nobody-here');
      expect(res.status).toBe(404);
    });

    it('returns 404 for a malformed slug without querying the database', async () => {
      expect((await call('GET', '/c/NotASlug')).status).toBe(404);
      expect((await call('GET', '/c/-bad')).status).toBe(404);
      expect((await call('GET', '/c/a')).status).toBe(404);
    });

    it('resolves a slug within the requesting brand only (same slug, two brands, two profiles)', async () => {
      const wkrpMatt = await register('Matt WKRP');
      const bronzevilleMatt = await register('Matt Bronzeville', BRAND_HOST);
      await claimSlug(wkrpMatt.cookie, 'matt');
      await claimSlug(bronzevilleMatt.cookie, 'matt', BRAND_HOST);

      const wkrpHtml = await (await call('GET', '/c/matt')).text();
      expect(wkrpHtml).toContain(`data-contributor-id="${wkrpMatt.id}"`);
      expect(wkrpHtml).toContain('content="Matt WKRP — WKRP"');

      const brandHtml = await (await call('GET', '/c/matt', { origin: BRAND_HOST })).text();
      expect(brandHtml).toContain(`data-contributor-id="${bronzevilleMatt.id}"`);
      expect(brandHtml).toContain('content="Matt Bronzeville — Bronzeville"');
    });

    it('keeps the canonical URL on the brand host it was requested from (a cross-brand canonical would point at a different person)', async () => {
      const bronzevilleMatt = await register('Matt Bronzeville', BRAND_HOST);
      await claimSlug(bronzevilleMatt.cookie, 'matt', BRAND_HOST);

      const html = await (await call('GET', '/c/matt', { origin: BRAND_HOST })).text();
      expect(html).toContain(`<link rel="canonical" href="${BRAND_HOST}/c/matt">`);
      expect(html).not.toContain(`${BASE_URL}/c/matt`);
    });
  });

  describe('GET /contributor/:uuid — the canonical route is unchanged', () => {
    it('still serves the profile page for a contributor with no slug', async () => {
      const matt = await register('Matt');
      const res = await call('GET', `/contributor/${matt.id}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('data-testid="profile-view"');
      expect(html).toContain(`<body data-contributor-id="${matt.id}">`);
    });

    it('falls back to the UUID URL for canonical when no slug is claimed', async () => {
      const matt = await register('Matt');
      const html = await (await call('GET', `/contributor/${matt.id}`)).text();
      expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/contributor/${matt.id}">`);
    });

    it('prefers the vanity URL for canonical once a slug is claimed (one canonical, no duplicate content)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      const html = await (await call('GET', `/contributor/${matt.id}`)).text();
      expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/c/matt">`);
    });

    it('serves the page without OG meta for an unknown UUID (existing behaviour preserved)', async () => {
      const res = await call('GET', '/contributor/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('data-testid="profile-view"');
      expect(html).not.toContain('og:title');
    });

    it('serves the page without OG meta for a non-UUID id (no pointless database hit)', async () => {
      const res = await call('GET', '/contributor/not-a-uuid');
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('og:title');
    });
  });

  describe('GET /catalog — static landing OG meta', () => {
    it('injects static OG meta with no per-request lookup', async () => {
      const res = await call('GET', '/catalog');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<meta property="og:title" content="WKRP — Catalog">');
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/catalog">`);
    });
  });

  describe('GET /api/contributors/:id — profile payload', () => {
    it('exposes slug additively once claimed', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      const res = await call('GET', `/api/contributors/${matt.id}`);
      const body = await res.json() as { contributor: { slug: string | null } };
      expect(body.contributor.slug).toBe('matt');
    });

    it('returns slug: null before a claim (additive, never absent)', async () => {
      const matt = await register('Matt');
      const res = await call('GET', `/api/contributors/${matt.id}`);
      const body = await res.json() as { contributor: Record<string, unknown> };
      expect(body.contributor).toHaveProperty('slug');
      expect(body.contributor.slug).toBeNull();
    });

    it('does not expose slug_locked (owner-only control flag)', async () => {
      const matt = await register('Matt');
      await claimSlug(matt.cookie, 'matt');
      const res = await call('GET', `/api/contributors/${matt.id}`);
      const body = await res.json() as { contributor: Record<string, unknown> };
      expect(body.contributor).not.toHaveProperty('slug_locked');
    });
  });
});
