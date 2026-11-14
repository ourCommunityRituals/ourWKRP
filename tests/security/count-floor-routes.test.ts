/**
 * Behavioural tests: the under-5 floor on every route that publishes a count
 * of people or of people's actions (owner rule 2026-11-14: no reader, no
 * exception). Each test seeds a real D1 (Miniflare, schema from migrations/)
 * and calls the real handler.
 *
 * For each route:
 *   - a sweep over true values 0, 1, 4, 5, 6: 1 to 4 read as the withheld
 *     shape ({ <field>: null, <field>_suppressed: true }); 0 reads the same as
 *     1 to 4 on every route; 5 and 6 are published exactly;
 *   - a neighbour test: one more action inside a group under the floor leaves
 *     the whole response byte-identical;
 *   - a control: one more action in a group above the floor changes the
 *     response, so the harness can fail.
 *
 * The event routes also get the three-cut test: one DJ with 3 taps next to
 * DJs with many, and no sum or difference of the published numbers gives 3.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { handleGetEventMusic } from '../../src/handlers/events';
import { handleSponsorReport } from '../../src/handlers/sponsor';
import { handleGetStats, handleGetBrands } from '../../src/handlers/catalog';
import { handleGetDjStats } from '../../src/handlers/dj';
import { COUNT_FLOOR } from '../../src/lib/count-floor';
import type { Env } from '../../src/types';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const TOKEN = 'test-ose-integration-token';
const EVENT = 'evt-1';
const SWEEP = [0, 1, 4, 5, 6] as const;

const DATA_TABLES = [
  'preferred_playlists', 'playlist_tracks', 'playlists', 'set_tracks', 'attributions',
  'dj_sets', 'contributions', 'track_identifiers', 'contributor_roles', 'tracks', 'contributors',
];

/** Split a migration into statements, keeping CREATE TRIGGER ... END; blocks whole. */
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
    if ((upper.match(/\bBEGIN\b/g) ?? []).length <= (upper.match(/\bEND\b/g) ?? []).length) {
      if (buf.trim()) statements.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) statements.push(buf.trim());
  return statements;
}

let mf: Miniflare;
let db: D1Database;
let env: Env;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Databases: ['WKRP_DB'],
  });
  db = (await mf.getD1Database('WKRP_DB')) as unknown as D1Database;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of splitSqlStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        if (/already exists|duplicate column/i.test(String(err))) continue;
        throw new Error(`Migration ${file} failed: ${String(err)}`);
      }
    }
  }
  env = { WKRP_DB: db, OSE_INTEGRATION_TOKEN: TOKEN } as unknown as Env;
}, 60000);

afterAll(async () => {
  await mf?.dispose();
});

beforeEach(async () => {
  for (const table of DATA_TABLES) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("DELETE FROM brands WHERE id <> 'wkrp'").run();
});

// --- Seeding ---------------------------------------------------------------

interface Tap {
  dj: string;
  track: string;
  /** null = an anonymous tap. */
  listener?: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' */
  at?: string;
  event?: string | null;
}

let seq = 0;
const nextId = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`;

function contributorStmt(id: string, role: string, brand = 'wkrp', status = 'active') {
  return db
    .prepare(
      `INSERT OR IGNORE INTO contributors (id, name, generation, brand_id, role, status, created_at)
       VALUES (?, ?, 'gen2', ?, ?, ?, '2026-11-01 00:00:00')`
    )
    .bind(id, `Name ${id}`, brand, role, status);
}

function trackStmt(id: string) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO tracks (id, name, artist, album, genre, created_at)
       VALUES (?, ?, 'Artist', 'Album', 'house', '2026-11-01 00:00:00')`
    )
    .bind(id, `Track ${id}`);
}

async function seedTaps(taps: Tap[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const t of taps) {
    stmts.push(contributorStmt(t.dj, 'dj'));
    if (t.listener) stmts.push(contributorStmt(t.listener, 'listener'));
    stmts.push(trackStmt(t.track));
    stmts.push(
      db
        .prepare(
          `INSERT INTO attributions (id, dj_id, listener_id, track_id, event_id, attributed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(nextId('attr'), t.dj, t.listener ?? null, t.track, t.event === undefined ? EVENT : t.event, t.at ?? '2026-11-01 21:10:00')
    );
  }
  if (stmts.length) await db.batch(stmts);
}

/** n taps by one DJ on one track in one hour; `named` of them from distinct listeners. */
function taps(n: number, o: { dj?: string; track?: string; at?: string; named?: number; listenerPrefix?: string } = {}): Tap[] {
  return Array.from({ length: n }, (_, i) => ({
    dj: o.dj ?? 'dj-a',
    track: o.track ?? 't-1',
    at: o.at ?? '2026-11-01 21:10:00',
    listener: i < (o.named ?? 0) ? `${o.listenerPrefix ?? 'ls'}-${o.dj ?? 'dj-a'}-${o.track ?? 't-1'}-${i}` : null,
  }));
}

async function resetData(): Promise<void> {
  for (const table of DATA_TABLES) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("DELETE FROM brands WHERE id <> 'wkrp'").run();
}

// --- Calling the routes ----------------------------------------------------

const authed = (url: string) => new Request(url, { headers: { Authorization: `Bearer ${TOKEN}` } });

async function music(): Promise<string> {
  const res = await handleGetEventMusic(authed(`https://ourwkrp.com/api/events/${EVENT}/music`), env, EVENT);
  expect(res.status).toBe(200);
  return res.text();
}

async function sponsor(): Promise<string> {
  // generated_at is the only clock read; pin it so two calls can be compared byte for byte.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  try {
    const res = await handleSponsorReport(authed(`https://ourwkrp.com/api/sponsors/${EVENT}/report`), env, EVENT);
    expect(res.status).toBe(200);
    return await res.text();
  } finally {
    vi.useRealTimers();
  }
}

async function stats(): Promise<string> {
  const res = await handleGetStats(new Request('https://ourwkrp.com/api/stats'), env);
  expect(res.status).toBe(200);
  return res.text();
}

async function brands(): Promise<string> {
  const res = await handleGetBrands(new Request('https://ourwkrp.com/api/brands'), env);
  expect(res.status).toBe(200);
  return res.text();
}

async function djStats(dj = 'dj-a'): Promise<string> {
  const res = await handleGetDjStats(new Request(`https://ourwkrp.com/dj/${dj}/stats`), env, dj);
  expect(res.status).toBe(200);
  return res.text();
}

type Obj = Record<string, unknown>;

/** Assert one floored field: exact at or above the floor, the withheld shape under it (0 included). */
function expectFloored(container: Obj, field: string, trueValue: number): void {
  if (trueValue >= COUNT_FLOOR) {
    expect(container[field], `${field} at ${trueValue}`).toBe(trueValue);
    expect(container[`${field}_suppressed`], `${field}_suppressed at ${trueValue}`).toBe(false);
  } else {
    expect(container[field], `${field} at ${trueValue}`).toBeNull();
    expect(container[`${field}_suppressed`], `${field}_suppressed at ${trueValue}`).toBe(true);
  }
}

// ===========================================================================
// GET /api/events/:eventId/music
// ===========================================================================
describe('GET /api/events/:eventId/music: every count is floored', () => {
  const statsOf = async () => (JSON.parse(await music()) as { music: { stats: Obj } }).music.stats;

  for (const n of SWEEP) {
    it(`total_attributions with ${n} taps`, async () => {
      await seedTaps(taps(n));
      expectFloored(await statsOf(), 'total_attributions', n);
    });

    it(`distinct_listeners with ${n} signed-in listeners`, async () => {
      await seedTaps(taps(10, { named: n }));
      expectFloored(await statsOf(), 'distinct_listeners', n);
    });

    it(`dj_count with ${n} DJs`, async () => {
      const all: Tap[] = [];
      for (let d = 0; d < n; d++) all.push(...taps(COUNT_FLOOR, { dj: `dj-${d}` }));
      await seedTaps(all);
      expectFloored(await statsOf(), 'dj_count', n);
    });
  }

  it('publishes no count of the groups it left out', async () => {
    await seedTaps([...taps(10, { named: 10 }), ...taps(3, { track: 't-9', named: 3 })]);
    const body = JSON.parse(await music()) as { music: Obj };
    expect(body.music).not.toHaveProperty('top_tracks_below_floor');
    expect(await music()).not.toMatch(/below_floor/);
  });
});

// ===========================================================================
// GET /api/sponsors/:eventId/report
// ===========================================================================
describe('GET /api/sponsors/:eventId/report: every count is floored', () => {
  const summaryOf = async () => (JSON.parse(await sponsor()) as { report: { summary: Obj } }).report.summary;

  for (const n of SWEEP) {
    it(`total_attributions with ${n} taps`, async () => {
      await seedTaps(taps(n));
      expectFloored(await summaryOf(), 'total_attributions', n);
    });

    it(`distinct_listeners with ${n} signed-in listeners`, async () => {
      await seedTaps(taps(10, { named: n }));
      expectFloored(await summaryOf(), 'distinct_listeners', n);
    });

    it(`total_djs with ${n} DJs`, async () => {
      const all: Tap[] = [];
      for (let d = 0; d < n; d++) all.push(...taps(COUNT_FLOOR, { dj: `dj-${d}` }));
      await seedTaps(all);
      expectFloored(await summaryOf(), 'total_djs', n);
    });
  }

  it('publishes no count of the rows it left out', async () => {
    await seedTaps([...taps(10, { named: 10 }), ...taps(3, { dj: 'dj-x', named: 3 })]);
    const body = await sponsor();
    expect(body).not.toMatch(/below_floor/);
  });
});

// ===========================================================================
// Event routes: neighbours, control, and the three-cut test
// ===========================================================================

/** Two DJs well above the floor, in two hours, on three tracks; every tap signed in. */
function busyEvent(): Tap[] {
  return [
    ...taps(5, { dj: 'dj-a', track: 't-1', at: '2026-11-01 21:05:00', named: 5 }),
    ...taps(5, { dj: 'dj-a', track: 't-2', at: '2026-11-01 22:05:00', named: 5 }),
    ...taps(10, { dj: 'dj-b', track: 't-1', at: '2026-11-01 21:20:00', named: 10 }),
    ...taps(10, { dj: 'dj-b', track: 't-3', at: '2026-11-01 22:20:00', named: 10 }),
  ];
}

/** A DJ with 3 taps, on the busiest track in the busiest hour, each from a new listener. */
const smallDj = (n = 3): Tap[] => taps(n, { dj: 'dj-x', track: 't-1', at: '2026-11-01 21:40:00', named: n, listenerPrefix: 'lx' });

for (const [name, read] of [
  ['music', music],
  ['sponsor report', sponsor],
] as const) {
  describe(`${name}: one action inside a group under the floor changes nothing`, () => {
    const levers: Array<[string, Tap[], Tap[]]> = [
      ['a DJ with 3 taps gains a fourth (from a new listener)', smallDj(3), smallDj(4)],
      ['a track with 3 taps gains a fourth', taps(3, { track: 't-9', at: '2026-11-01 21:30:00', named: 3, listenerPrefix: 'l9' }), taps(4, { track: 't-9', at: '2026-11-01 21:30:00', named: 4, listenerPrefix: 'l9' })],
      ['an hour with 2 taps gains a third', taps(2, { dj: 'dj-b', track: 't-3', at: '2026-11-01 23:15:00', named: 2, listenerPrefix: 'l23' }), taps(3, { dj: 'dj-b', track: 't-3', at: '2026-11-01 23:15:00', named: 3, listenerPrefix: 'l23' })],
      ['a DJ with no taps gains a first', [], taps(1, { dj: 'dj-y', track: 't-2', at: '2026-11-01 22:30:00', named: 1, listenerPrefix: 'ly' })],
    ];
    for (const [label, before, after] of levers) {
      it(label, async () => {
        await seedTaps([...busyEvent(), ...before]);
        const a = await read();
        await resetData();
        await seedTaps([...busyEvent(), ...after]);
        expect(await read()).toBe(a);
      });
    }

    it('control: one more tap for a DJ above the floor changes the response', async () => {
      await seedTaps(busyEvent());
      const a = await read();
      await resetData();
      await seedTaps([...busyEvent(), ...taps(1, { dj: 'dj-b', track: 't-1', at: '2026-11-01 21:50:00', named: 1, listenerPrefix: 'lc' })]);
      expect(await read()).not.toBe(a);
    });

    it('a DJ with 3 taps among DJs with many reads exactly as if that DJ had no taps', async () => {
      await seedTaps(busyEvent());
      const without = await read();
      await resetData();
      await seedTaps([...busyEvent(), ...smallDj(3)]);
      expect(await read()).toBe(without);
    });
  });
}

/** Every number in a JSON value, with its path. */
function numbersIn(value: unknown, path = '$', out: Array<[string, number]> = []): Array<[string, number]> {
  if (typeof value === 'number') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numbersIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) numbersIn(v, `${path}.${k}`, out);
  return out;
}

/** All subset sums of a short list of numbers. */
function subsetSums(xs: number[]): number[] {
  let sums = [0];
  for (const x of xs) sums = [...sums, ...sums.map((s) => s + x)];
  return sums;
}

describe('sponsor report: three cuts of one event never give back a 3-tap DJ', () => {
  it('no sum or difference of the published numbers is 3', async () => {
    await seedTaps([...busyEvent(), ...smallDj(3)]);
    const report = (JSON.parse(await sponsor()) as { report: Obj }).report;
    const summary = report.summary as Obj;
    const total = summary.total_attributions as number;
    expect(total).toBe(30);

    const cuts: Record<string, number[]> = {
      timeline: (report.timeline as Obj[]).map((r) => Number(r.count)),
      dj_breakdown: (report.dj_breakdown as Obj[]).map((r) => Number(r.attribution_count)),
      top_tracks: (report.top_tracks as Obj[]).map((r) => Number(r.attribution_count)),
    };
    // Every cut sums to the same published total.
    for (const [cut, xs] of Object.entries(cuts)) {
      expect(xs.reduce((s, x) => s + x, 0), `${cut} sums to the total`).toBe(total);
    }
    // No partial sum of one cut, taken from the total or from a partial sum of
    // another cut, is 3.
    const sums = Object.values(cuts).flatMap(subsetSums).concat(total);
    for (const a of sums) for (const b of sums) expect(Math.abs(a - b), `${a} - ${b}`).not.toBe(3);
    // And no two published numbers anywhere differ by 3 or add to 3.
    const all = numbersIn(report).map(([, n]) => n);
    for (const a of all) {
      expect(all.includes(a + 3), `${a} and ${a + 3}`).toBe(false);
      expect(all.includes(3 - a), `${a} and ${3 - a}`).toBe(false);
    }
  });
});

describe('music: the same event read from the music route never gives back the 3-tap DJ', () => {
  it('every published total equals the sum of the listed tracks, and no difference is 3', async () => {
    await seedTaps([...busyEvent(), ...smallDj(3)]);
    const m = (JSON.parse(await music()) as { music: Obj }).music;
    const st = m.stats as Obj;
    const listed = (m.top_tracks as Obj[]).map((t) => Number(t.attribution_count));
    expect(listed.reduce((s, x) => s + x, 0)).toBe(st.total_attributions);
    const all = numbersIn(m).map(([, n]) => n);
    for (const a of all) {
      expect(all.includes(a + 3), `${a} and ${a + 3}`).toBe(false);
      expect(all.includes(3 - a), `${a} and ${3 - a}`).toBe(false);
    }
  });

  it('the music route and the sponsor report publish the same total for the same event', async () => {
    await seedTaps([...busyEvent(), ...smallDj(3)]);
    const m = (JSON.parse(await music()) as { music: { stats: Obj } }).music.stats;
    const s = (JSON.parse(await sponsor()) as { report: { summary: Obj } }).report.summary;
    expect(m.total_attributions).toBe(s.total_attributions);
    expect(m.distinct_listeners).toBe(s.distinct_listeners);
    expect(m.dj_count).toBe(s.total_djs);
  });
});

// ===========================================================================
// GET /api/stats
// ===========================================================================
async function seedContributors(n: number, brand = 'wkrp', prefix = 'c'): Promise<void> {
  const stmts = Array.from({ length: n }, (_, i) => contributorStmt(`${prefix}-${brand}-${i}`, 'contributor', brand));
  if (stmts.length) await db.batch(stmts);
}

describe('GET /api/stats: total_contributors is floored', () => {
  for (const n of SWEEP) {
    it(`with ${n} active contributors`, async () => {
      await seedContributors(n);
      const s = (JSON.parse(await stats()) as { stats: Obj }).stats;
      expectFloored(s, 'total_contributors', n);
      expect(s.reporting_floor).toBe(COUNT_FLOOR);
    });
  }

  it('one more contributor under the floor changes nothing', async () => {
    await seedContributors(3);
    const a = await stats();
    await seedContributors(1, 'wkrp', 'extra');
    expect(await stats()).toBe(a);
  });

  it('control: one more contributor above the floor changes the response', async () => {
    await seedContributors(6);
    const a = await stats();
    await seedContributors(1, 'wkrp', 'extra');
    expect(await stats()).not.toBe(a);
  });
});

// ===========================================================================
// GET /api/brands
// ===========================================================================
async function seedContributions(n: number, contributor = 'c-wkrp-0'): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    const track = `bt-${contributor}-${i}`;
    stmts.push(trackStmt(track));
    stmts.push(
      db
        .prepare(
          `INSERT INTO contributions (id, track_id, contributor_id, source_type, source_platform, created_at)
           VALUES (?, ?, ?, 'csv', 'csv', '2026-11-01 00:00:00')`
        )
        .bind(nextId('cn'), track, contributor)
    );
  }
  if (stmts.length) await db.batch(stmts);
}

describe('GET /api/brands: contributor_count and track_count are floored', () => {
  const wkrpOf = async () => {
    const body = JSON.parse(await brands()) as { brands: Obj[]; reporting_floor: number };
    expect(body.reporting_floor).toBe(COUNT_FLOOR);
    return body.brands.find((b) => b.id === 'wkrp') as Obj;
  };

  for (const n of SWEEP) {
    it(`contributor_count with ${n} active contributors`, async () => {
      await seedContributors(n);
      expectFloored(await wkrpOf(), 'contributor_count', n);
    });

    it(`track_count with ${n} contribution rows`, async () => {
      await seedContributors(1);
      await seedContributions(n);
      expectFloored(await wkrpOf(), 'track_count', n);
    });
  }

  it('one more contributor or contribution under the floor changes nothing', async () => {
    await seedContributors(3);
    await seedContributions(3);
    const a = await brands();
    await seedContributors(1, 'wkrp', 'extra');
    await seedContributions(1, 'c-wkrp-1');
    expect(await brands()).toBe(a);
  });

  it('control: one more contribution above the floor changes the response', async () => {
    await seedContributors(6);
    await seedContributions(6);
    const a = await brands();
    await seedContributions(1, 'c-wkrp-1');
    expect(await brands()).not.toBe(a);
  });
});

// ===========================================================================
// GET /dj/:id/stats
// ===========================================================================
describe('GET /dj/:id/stats: listener counts and attributions are floored', () => {
  const statsOf = async () => (JSON.parse(await djStats()) as { stats: Obj }).stats;

  for (const n of SWEEP) {
    it(`total_attributions with ${n} taps on one track`, async () => {
      await seedTaps(taps(n).map((t) => ({ ...t, event: null })));
      expectFloored(await statsOf(), 'total_attributions', n);
    });

    it(`unique_listeners with ${n} signed-in listeners`, async () => {
      await seedTaps(taps(10, { named: n }));
      expectFloored(await statsOf(), 'unique_listeners', n);
    });
  }

  it('one more tap, from a new listener, on a track under the floor changes nothing', async () => {
    await seedTaps([...taps(7, { named: 7 }), ...taps(3, { track: 't-9', named: 3, listenerPrefix: 'l9' })]);
    const a = await djStats();
    await resetData();
    await seedTaps([...taps(7, { named: 7 }), ...taps(4, { track: 't-9', named: 4, listenerPrefix: 'l9' })]);
    expect(await djStats()).toBe(a);
  });

  it('control: one more tap on a track above the floor changes the response', async () => {
    await seedTaps(taps(7, { named: 7 }));
    const a = await djStats();
    await seedTaps(taps(1, { listenerPrefix: 'lc' }));
    expect(await djStats()).not.toBe(a);
  });
});
