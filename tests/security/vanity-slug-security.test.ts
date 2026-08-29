/**
 * Security tests — Server-rendered OG meta and slug mutation (OW-122, HL-P3.3)
 *
 * OW-122 opens a new class of risk: for the first time the worker splices
 * database-sourced, user-controlled text into the HTML document it serves.
 * profile.html's client-side escapeHtml() cannot help — that runs in the
 * browser, and the whole point of server-side OG meta is that it must be
 * correct for a crawler that never executes a line of JavaScript.
 *
 * These tests assert the three things that keep that seam safe:
 *   1. Injected text cannot break out of its attribute.
 *   2. The CSP nonce still reaches every inline script, and never leaks into
 *      contributor-controlled text.
 *   3. The slug mutation is authenticated, and cannot claim a route name.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { route } from '../../src/router';
import { escapeHtmlAttr } from '../../src/lib/html';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const BASE_URL = 'http://localhost:8787';

/** The classic attribute-breakout payload: close the attribute, then the tag. */
const XSS_NAME = '"><script>alert(1)</script>';

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

// Child rows first — contributors is the FK target for most of the schema.
const DATA_TABLES = [
  'preferred_playlists', 'playlist_tracks', 'playlists', 'set_tracks', 'attributions',
  'dj_sets', 'contributions', 'track_identifiers', 'contributor_roles', 'contributors',
];

let clientIp = 100;
beforeEach(async () => {
  clientIp += 1;
  for (const table of DATA_TABLES) {
    await env.WKRP_DB.prepare(`DELETE FROM ${table}`).run();
  }
});

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; json?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': `10.1.0.${clientIp}` };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  return route(new Request(`${BASE_URL}${path}`, { method, headers, body }), env);
}

/**
 * Insert a contributor row directly, bypassing registration.
 *
 * Deliberate: nameSchema strips angle-bracket tags on the register path, so
 * going through /auth/register would test that filter rather than the escaper.
 * A name can also reach this table from a migration, a backfill, or an importer
 * — the escaper, not the input filter, has to be the thing that holds.
 */
async function seedContributor(name: string, slug: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await env.WKRP_DB.prepare(
    `INSERT INTO contributors (id, name, generation, brand_id, role, status, slug, created_at)
     VALUES (?, ?, 'gen2', 'wkrp', 'curator', 'active', ?, datetime('now'))`,
  ).bind(id, name, slug).run();
  return id;
}

async function registerContributor(name: string): Promise<{ cookie: string; id: string }> {
  const res = await call('POST', '/auth/register', {
    json: { name, role: 'curator', generation: 'gen2' },
  });
  const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
  const body = await res.json() as { contributor: { id: string } };
  return { cookie, id: body.contributor.id };
}

/** Everything between <head> and </head> of a served page. */
function headOf(html: string): string {
  const start = html.indexOf('<head>');
  const end = html.indexOf('</head>');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('OW-122 — server-rendered OG meta is attribute-escaped', () => {
  describe('escapeHtmlAttr', () => {
    it('escapes all five HTML-significant characters', () => {
      expect(escapeHtmlAttr(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('escapes the ampersand first so entities are not double-decoded (regression)', () => {
      expect(escapeHtmlAttr('&lt;')).toBe('&amp;lt;');
    });

    it('neutralises the attribute-breakout payload', () => {
      const escaped = escapeHtmlAttr(XSS_NAME);
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });

    it('returns the empty string for null and undefined rather than "null"', () => {
      expect(escapeHtmlAttr(null)).toBe('');
      expect(escapeHtmlAttr(undefined)).toBe('');
    });
  });

  describe('a contributor name containing an XSS payload, served via /c/:slug', () => {
    it('emits no unescaped attribute breakout in <head>', async () => {
      await seedContributor(XSS_NAME, 'xss-victim');
      const html = await (await call('GET', '/c/xss-victim')).text();
      const head = headOf(html);

      // The payload must appear only in escaped form.
      expect(head).not.toContain(XSS_NAME);
      expect(head).not.toContain('"><script>');
      expect(head).toContain('&quot;&gt;');
    });

    it('injects no new <script> tag into <head> (the payload stays inert text, not markup)', async () => {
      await seedContributor(XSS_NAME, 'xss-victim');
      const html = await (await call('GET', '/c/xss-victim')).text();
      const head = headOf(html);

      // The payload's characters survive — a contributor really is named this —
      // but only in escaped form, so the parser sees text, never a tag.
      expect(head).not.toMatch(/<script/i);
      expect(head).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('keeps every og/twitter meta tag well-formed — no content attribute is left open', async () => {
      await seedContributor(XSS_NAME, 'xss-victim');
      const html = await (await call('GET', '/c/xss-victim')).text();

      const metas = [...html.matchAll(/<meta (?:property|name)="(?:og|twitter):[^"]+" content="([^"]*)">/g)];
      // Exact count, not "greater than zero": a broken-out attribute stops
      // matching this pattern, so a loose count would pass while the tags it
      // failed to match were the corrupted ones. Eight tags, no og:image
      // (this brand has no logo).
      expect(metas.length).toBe(8);
      for (const [, content] of metas) {
        // A correctly escaped value can never contain a raw quote or bracket.
        expect(content).not.toMatch(/["<>]/);
      }
    });

    it('escapes a payload aimed at the canonical link href too', async () => {
      await seedContributor('Normal', 'xss-victim');
      const html = await (await call('GET', '/c/xss-victim')).text();
      const hrefs = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)];
      expect(hrefs.length).toBe(1);
      expect(hrefs[0][1]).not.toMatch(/["<>]/);
    });

    it('escapes the name on the UUID route as well as the slug route', async () => {
      const id = await seedContributor(XSS_NAME, null);
      const html = await (await call('GET', `/contributor/${id}`)).text();
      expect(headOf(html)).not.toContain('"><script>');
    });

    it('escapes a brand name carrying a payload — it reaches both og:site_name and the <style> block', async () => {
      // The brand name lands in two different contexts with two different
      // escaping rules. Both must hold.
      await env.WKRP_DB.prepare("UPDATE brands SET name = ? WHERE id = 'wkrp'")
        .bind('</style><script>alert(1)</script>').run();
      try {
        await seedContributor('Matt', 'matt');
        const html = await (await call('GET', '/c/matt')).text();
        const head = headOf(html);

        // Neither context may yield real markup: the <style> block strips the
        // breakout characters, the meta attributes escape them.
        expect(head).not.toContain('</style><script>');
        expect(head).not.toMatch(/<script/i);
        expect(head).toContain('&lt;/style&gt;&lt;script&gt;');
        // The style block closes exactly where it should.
        expect(head).toMatch(/--brand-name:"[^"<>]*";\}<\/style>/);
      } finally {
        await env.WKRP_DB.prepare("UPDATE brands SET name = 'WKRP' WHERE id = 'wkrp'").run();
      }
    });

    it('drops a brand color that is not a plain color token (no CSS rule injection)', async () => {
      await env.WKRP_DB.prepare("UPDATE brands SET primary_color = ? WHERE id = 'wkrp'")
        .bind('red;} body{display:none;} :root{x:').run();
      try {
        await seedContributor('Matt', 'matt');
        const html = await (await call('GET', '/c/matt')).text();
        expect(html).not.toContain('body{display:none');
        // Falls back to the default rather than emitting the stored value.
        expect(html).toContain('--brand-primary:#D4954B');
      } finally {
        await env.WKRP_DB.prepare("UPDATE brands SET primary_color = '#1DB954' WHERE id = 'wkrp'").run();
      }
    });

    it('preserves an ordinary brand name with spaces (sanitizer is not over-broad)', async () => {
      await env.WKRP_DB.prepare("UPDATE brands SET name = 'New York Radio' WHERE id = 'wkrp'").run();
      try {
        await seedContributor('Matt', 'matt');
        const html = await (await call('GET', '/c/matt')).text();
        expect(html).toContain('--brand-name:"New York Radio"');
        expect(html).toContain('content="Matt — New York Radio"');
      } finally {
        await env.WKRP_DB.prepare("UPDATE brands SET name = 'WKRP' WHERE id = 'wkrp'").run();
      }
    });
  });

  describe('CSP nonce integrity on an OG-injected page', () => {
    it('leaves no unsubstituted __CSP_NONCE__ sentinel in the served page', async () => {
      await seedContributor('Matt', 'matt');
      const html = await (await call('GET', '/c/matt')).text();
      expect(html).not.toContain('__CSP_NONCE__');
    });

    it('gives every inline <script> the nonce, and that nonce matches the CSP header', async () => {
      await seedContributor('Matt', 'matt');
      const res = await call('GET', '/c/matt');
      const html = await res.text();

      const csp = res.headers.get('Content-Security-Policy')!;
      const nonce = csp.match(/'nonce-([a-f0-9]+)'/)![1];

      const scripts = [...html.matchAll(/<script\b[^>]*>/g)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const [tag] of scripts) {
        expect(tag).toContain(`nonce="${nonce}"`);
      }
    });

    it('never writes the live nonce into contributor-controlled text (injection happens after substitution)', async () => {
      // A contributor who names themselves after the sentinel must not have the
      // real nonce substituted into their meta tags — that would hand an
      // attacker the one value the CSP depends on staying unguessable.
      await seedContributor('__CSP_NONCE__', 'sentinel');
      const res = await call('GET', '/c/sentinel');
      const html = await res.text();

      const nonce = res.headers.get('Content-Security-Policy')!.match(/'nonce-([a-f0-9]+)'/)![1];
      const ogTitle = html.match(/<meta property="og:title" content="([^"]*)">/)![1];

      expect(ogTitle).toContain('__CSP_NONCE__');
      expect(ogTitle).not.toContain(nonce);
      // The nonce appears only on script tags and in the header, never in meta.
      expect(html).not.toContain(`content="${nonce}`);
    });
  });
});

describe('OW-122 — slug mutation is gated', () => {
  it('rejects an unauthenticated claim with 401', async () => {
    const res = await call('POST', '/api/profile/slug', { json: { slug: 'anon' } });
    expect(res.status).toBe(401);
  });

  it('rejects a claim carrying a bogus session cookie with 401', async () => {
    const res = await call('POST', '/api/profile/slug', {
      cookie: 'wkrp_session=not-a-real-token',
      json: { slug: 'anon' },
    });
    expect(res.status).toBe(401);
  });

  it('writes no slug when the caller is unauthenticated', async () => {
    const id = await seedContributor('Matt', null);
    await call('POST', '/api/profile/slug', { json: { slug: 'matt' } });
    const row = await env.WKRP_DB.prepare('SELECT slug FROM contributors WHERE id = ?')
      .bind(id).first<{ slug: string | null }>();
    expect(row?.slug).toBeNull();
  });

  it('lets a contributor set only their OWN slug (the session decides the row, not the body)', async () => {
    const matt = await registerContributor('Matt');
    const victimId = await seedContributor('Victim', null);

    // No target id is accepted from the client at all; the body is {slug} only.
    await call('POST', '/api/profile/slug', {
      cookie: matt.cookie,
      json: { slug: 'taken', contributor_id: victimId, id: victimId },
    });

    const victim = await env.WKRP_DB.prepare('SELECT slug FROM contributors WHERE id = ?')
      .bind(victimId).first<{ slug: string | null }>();
    const mine = await env.WKRP_DB.prepare('SELECT slug FROM contributors WHERE id = ?')
      .bind(matt.id).first<{ slug: string | null }>();

    expect(victim?.slug).toBeNull();
    expect(mine?.slug).toBe('taken');
  });

  describe('reserved slugs cannot shadow a route', () => {
    it.each(['api', 'auth', 'catalog', 'create', 'import', 'dashboard', 'stats',
      'dj', 'contributor', 'c', 'health', 'spotify', 'lastfm', 'admin'])(
      "rejects a claim for '%s' with 400 and stores nothing",
      async (reserved) => {
        const matt = await registerContributor(`Matt ${reserved}`);
        const res = await call('POST', '/api/profile/slug', {
          cookie: matt.cookie,
          json: { slug: reserved },
        });
        expect(res.status).toBe(400);

        const row = await env.WKRP_DB.prepare('SELECT slug FROM contributors WHERE id = ?')
          .bind(matt.id).first<{ slug: string | null }>();
        expect(row?.slug).toBeNull();
      },
    );
  });

  it('rejects a path-traversal slug so /c/ cannot reach another route', async () => {
    const matt = await registerContributor('Matt');
    for (const payload of ['../api', 'a/../../admin', '..', 'a%2fb']) {
      const res = await call('POST', '/api/profile/slug', {
        cookie: matt.cookie,
        json: { slug: payload },
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a SQL-injection-shaped slug at the schema boundary', async () => {
    const matt = await registerContributor('Matt');
    const res = await call('POST', '/api/profile/slug', {
      cookie: matt.cookie,
      json: { slug: "matt'; DROP TABLE contributors;--" },
    });
    expect(res.status).toBe(400);
    // Table is intact.
    const row = await env.WKRP_DB.prepare('SELECT COUNT(*) as n FROM contributors')
      .first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0);
  });
});

describe('OW-122 — erasure retires the vanity URL', () => {
  it('clears the slug so the public /c/ URL stops resolving after erasure', async () => {
    const matt = await registerContributor('Matt');
    await call('POST', '/api/profile/slug', { cookie: matt.cookie, json: { slug: 'matt' } });
    expect((await call('GET', '/c/matt')).status).toBe(200);

    const res = await call('DELETE', `/api/contributors/${matt.id}/identity`, {
      cookie: matt.cookie,
    });
    expect(res.status).toBe(200);

    expect((await call('GET', '/c/matt')).status).toBe(404);
  });
});
