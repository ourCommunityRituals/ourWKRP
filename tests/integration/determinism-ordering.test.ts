/**
 * L3 INTEGRATION — ordering determinism against real SQLite.
 *
 * This is the ONLY level that proves the tiebreakers actually work. The L0
 * static gate (tests/security/determinism.invariant.test.ts) proves a regex
 * matched the SQL text; it cannot tell you whether SQLite returns stable rows.
 * Here the queries run against a real D1 database built from the real
 * migrations, seeded with DELIBERATE TIES — rows with identical sort keys,
 * which is precisely the input that exposes an unstable ORDER BY.
 *
 * Each case is a matched pair:
 *   PASS — the shipped query, tie-seeded, must return identical order twice.
 *   FAIL — the same query WITHOUT its tiebreaker is shown to be tie-unstable,
 *          so the pass case is proven to be doing work rather than passing
 *          because SQLite happened to be stable for this data.
 *
 * The FAIL half is asserted structurally (the untiebroken query has no unique
 * final sort term) rather than by hoping SQLite shuffles — a nondeterminism
 * test that depends on observing actual nondeterminism is itself flaky.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { scanOrderByDeterminism } from '../support/determinism-scan';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const DATA_TABLES = [
  'preferred_playlists', 'playlist_tracks', 'playlists', 'set_tracks', 'attributions',
  'dj_sets', 'contributions', 'track_identifiers', 'contributor_roles', 'flag_facets',
  'tracks', 'contributors',
];

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
        throw new Error(`Migration ${file} failed:\n${stmt}\n→ ${err}`);
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
  await applyMigrations(db as unknown as D1Database);
  env = { WKRP_DB: db } as unknown as Env;
}, 60000);

afterAll(async () => {
  await mf?.dispose();
});

beforeEach(async () => {
  for (const table of DATA_TABLES) await env.WKRP_DB.prepare(`DELETE FROM ${table}`).run();
});

/** Seed N tracks that all tie on attribution_count for one DJ. */
async function seedTiedAttributions(djId: string, trackCount: number, perTrack: number) {
  await env.WKRP_DB.prepare(
    `INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
     VALUES (?, 'Tie DJ', 'founder', 'wkrp', 'dj', 'active', datetime('now'))`,
  ).bind(djId).run();

  for (let t = 0; t < trackCount; t++) {
    const trackId = `track-${String(t).padStart(3, '0')}`;
    await env.WKRP_DB.prepare(
      `INSERT INTO tracks (id, name, artist, album, created_at)
       VALUES (?, ?, 'Same Artist', 'Same Album', datetime('now'))`,
    ).bind(trackId, `Track ${t}`).run();

    // Identical attribution_count for every track — a total tie.
    for (let a = 0; a < perTrack; a++) {
      await env.WKRP_DB.prepare(
        `INSERT INTO attributions (id, dj_id, track_id, attributed_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).bind(`attr-${t}-${a}`, djId, trackId).run();
    }
  }
}

/** The shipped DJ top-tracks query (src/handlers/dj.ts) — with tiebreaker. */
const DJ_TOP_TRACKS_SHIPPED = `SELECT t.id, t.name, t.artist, COUNT(*) as attribution_count
   FROM attributions a
   INNER JOIN tracks t ON a.track_id = t.id
   WHERE a.dj_id = ?
   GROUP BY t.id ORDER BY attribution_count DESC, t.id ASC LIMIT 10`;

/** The same query as it was BEFORE the fix — no unique final sort term. */
const DJ_TOP_TRACKS_UNSTABLE = `SELECT t.id, t.name, t.artist, COUNT(*) as attribution_count
   FROM attributions a
   INNER JOIN tracks t ON a.track_id = t.id
   WHERE a.dj_id = ?
   GROUP BY t.id ORDER BY attribution_count DESC LIMIT 10`;

describe('determinism | DJ top tracks under a total tie', () => {
  const DJ = 'dj-tie-0001';

  beforeEach(async () => {
    // 25 tracks, 3 attributions each → every track ties, and LIMIT 10 cuts
    // through the middle of the tie. This is the leaderboard failure mode:
    // which 10 of the 25 surface is arbitrary without a tiebreaker.
    await seedTiedAttributions(DJ, 25, 3);
  });

  it('PASS — the shipped query returns an identical top-10 on repeat execution', async () => {
    const first = await env.WKRP_DB.prepare(DJ_TOP_TRACKS_SHIPPED).bind(DJ).all();
    const second = await env.WKRP_DB.prepare(DJ_TOP_TRACKS_SHIPPED).bind(DJ).all();
    const ids = (r: typeof first) => (r.results as { id: string }[]).map((x) => x.id);

    expect(ids(first)).toHaveLength(10);
    expect(ids(first)).toEqual(ids(second));
  });

  it('PASS — the tiebreaker picks a defined winner set, not an arbitrary one', async () => {
    const r = await env.WKRP_DB.prepare(DJ_TOP_TRACKS_SHIPPED).bind(DJ).all();
    const ids = (r.results as { id: string }[]).map((x) => x.id);
    // Every count ties, so `t.id ASC` fully determines the result: the ten
    // lowest ids. This is a specific, reviewable answer — the point of a
    // tiebreaker is that the outcome is decidable, not merely repeatable.
    expect(ids).toEqual([
      'track-000', 'track-001', 'track-002', 'track-003', 'track-004',
      'track-005', 'track-006', 'track-007', 'track-008', 'track-009',
    ]);
  });

  it('FAIL — the pre-fix query is structurally tie-unstable', () => {
    // Asserted structurally, not by observing a shuffle: a test that depends
    // on SQLite actually reordering would be flaky by construction.
    const violations = scanOrderByDeterminism(DJ_TOP_TRACKS_UNSTABLE);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('attribution_count');

    // And the shipped query is clean under the same scanner.
    expect(scanOrderByDeterminism(DJ_TOP_TRACKS_SHIPPED)).toEqual([]);
  });
});

describe('determinism | contributor list under duplicate names', () => {
  beforeEach(async () => {
    // Two real people can share a name. Before the fix, `ORDER BY c.name ASC`
    // ordered them arbitrarily.
    for (let i = 0; i < 6; i++) {
      await env.WKRP_DB.prepare(
        `INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
         VALUES (?, 'Same Name', 'gen2', 'wkrp', 'contributor', 'active', datetime('now'))`,
      ).bind(`contrib-${String(i).padStart(3, '0')}`).run();
    }
  });

  it('PASS — repeated reads return the same order for identically-named people', async () => {
    const sql = `SELECT c.id, c.name FROM contributors c
                 WHERE c.brand_id = ? AND c.status = 'active'
                 GROUP BY c.id ORDER BY c.name ASC, c.id ASC`;
    const a = await env.WKRP_DB.prepare(sql).bind('wkrp').all();
    const b = await env.WKRP_DB.prepare(sql).bind('wkrp').all();
    const ids = (r: typeof a) => (r.results as { id: string }[]).map((x) => x.id);

    expect(ids(a)).toHaveLength(6);
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).toEqual([...ids(a)].sort()); // fully determined by c.id ASC
  });
});

describe('determinism | contributor profile facets under a created_at tie', () => {
  // The contributor profile lists a person's self-declared facets
  // (src/handlers/catalog.ts, GET /api/contributors/:id). created_at defaults
  // to datetime('now'), so several facets declared in the same second TIE on
  // created_at — the realistic case, since a profile edit can add a batch at
  // once. What disambiguates them is the operative question this test pins.
  const CONTRIB = 'contrib-facet-0001';
  const DOMAINS = ['zydeco', 'bocce', 'trivia', 'pinball', 'cigar'];

  // The shipped query (with the tiebreaker this change added).
  const FACETS_SHIPPED =
    'SELECT id, domain, depth, created_at FROM flag_facets WHERE contributor_id = ? ORDER BY created_at ASC, domain ASC, id ASC';
  // The query as it was BEFORE the fix — domain was the final sort term.
  const FACETS_PREFIX =
    'SELECT id, domain, depth, created_at FROM flag_facets WHERE contributor_id = ? ORDER BY created_at ASC, domain ASC';

  beforeEach(async () => {
    await env.WKRP_DB.prepare(
      `INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
       VALUES (?, 'Facet Person', 'gen2', 'wkrp', 'contributor', 'active', datetime('now'))`,
    ).bind(CONTRIB).run();
    // All five facets share one created_at timestamp — a total tie on the
    // leading sort term. Insertion order is deliberately NOT domain-sorted, so
    // a stable result cannot come from insertion happening to be ordered.
    for (const domain of DOMAINS) {
      await env.WKRP_DB.prepare(
        `INSERT INTO flag_facets (id, contributor_id, domain, depth, created_at)
         VALUES (?, ?, ?, 'hobbyist', '2026-01-01T00:00:00Z')`,
      ).bind(`facet-${domain}`, CONTRIB, domain).run();
    }
  });

  it('PASS — the created_at tie is broken deterministically by domain, not arbitrarily', async () => {
    const first = await env.WKRP_DB.prepare(FACETS_SHIPPED).bind(CONTRIB).all();
    const second = await env.WKRP_DB.prepare(FACETS_SHIPPED).bind(CONTRIB).all();
    const domains = (r: typeof first) => (r.results as { domain: string }[]).map((x) => x.domain);

    expect(domains(first)).toHaveLength(5); // non-vacuity: the tie actually seeded
    expect(domains(first)).toEqual(domains(second));
    // Every row ties on created_at, so domain ASC fully determines the order:
    // the decidable answer is the domains sorted, independent of insert order.
    expect(domains(first)).toEqual([...DOMAINS].sort());
  });

  it('FAIL — the pre-fix query is structurally tie-unstable', () => {
    // Asserted structurally, matching this suite's convention: domain is unique
    // per contributor via UNIQUE(contributor_id, domain), so SQLite happens to
    // return it stably here — but the scanner (which cannot see a cross-statement
    // index) rightly refuses to depend on that, and id ASC makes the guarantee
    // hold even if that index is ever dropped.
    const violations = scanOrderByDeterminism(FACETS_PREFIX);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('domain');

    // And the shipped query is clean under the same scanner.
    expect(scanOrderByDeterminism(FACETS_SHIPPED)).toEqual([]);
  });
});
