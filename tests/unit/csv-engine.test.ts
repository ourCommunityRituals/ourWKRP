import { describe, it, expect, vi } from 'vitest';
import { importCsv } from '../../src/import/csv-engine';
import { normalizeTitle, normalizeArtist } from '../../src/lib/normalize';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

interface MockState {
  tracksByIsrc?: Record<string, string>;        // isrc -> track id
  tracksByCanon?: Record<string, string>;       // "title|||artist" -> track id
  identifiers?: Record<string, string>;         // "platform|||platform_id" -> track id
  contributions?: string[];                     // existing unique keys
}

/** Stateful D1 mock: supports chunked .all() lookups and .batch() writes. */
function createDb(state: MockState = {}) {
  const byIsrc = new Map(Object.entries(state.tracksByIsrc ?? {}));
  const byCanon = new Map(Object.entries(state.tracksByCanon ?? {}));
  const identifiers = new Map(Object.entries(state.identifiers ?? {}));
  const contributions = new Set(state.contributions ?? []);
  const calls = { lookups: 0, batches: 0, statements: 0 };

  function makeStmt(sql: string) {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...args: unknown[]) { stmt.binds = args; return stmt; },
      async all<T>() {
        calls.lookups++;
        const out: unknown[] = [];
        if (sql.includes('FROM tracks') && sql.includes('isrc IN')) {
          for (const isrc of stmt.binds as string[]) {
            const id = byIsrc.get(isrc);
            if (id) out.push({ id, isrc });
          }
        } else if (sql.includes('track_identifiers') && sql.includes('platform_id IN')) {
          const platform = stmt.binds[0] as string;
          for (const pid of stmt.binds.slice(1) as string[]) {
            const tid = identifiers.get(`${platform}|||${pid}`);
            if (tid) out.push({ track_id: tid, platform_id: pid });
          }
        } else if (sql.includes('canonical_title')) {
          for (let i = 0; i < stmt.binds.length; i += 2) {
            const t = stmt.binds[i] as string;
            const a = stmt.binds[i + 1] as string;
            const id = byCanon.get(`${t}|||${a}`);
            if (id) out.push({ id, canonical_title: t, canonical_artist: a });
          }
        }
        return { results: out as T[] };
      },
      async run() { return { success: true, meta: { changes: 1 } }; },
    };
    return stmt;
  }

  const db = {
    prepare: vi.fn((sql: string) => makeStmt(sql)),
    batch: vi.fn(async (stmts: ReturnType<typeof makeStmt>[]) => {
      calls.batches++;
      calls.statements += stmts.length;
      return stmts.map((s) => {
        if (s.sql.includes('INTO contributions')) {
          const [, track_id, contributor_id, source_type, source_name] = s.binds as string[];
          const key = `${track_id}|||${contributor_id}|||${source_type}|||${source_name ?? ''}`;
          if (contributions.has(key)) return { success: true, meta: { changes: 0 } };
          contributions.add(key);
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 1 } };
      });
    }),
  };

  return { db: db as unknown as D1Database, calls };
}

function envWith(db: D1Database): Env {
  return { WKRP_DB: db } as unknown as Env;
}

const HEADER = 'Track Name,Artist Name(s),Album Name,ISRC,Track URI';

function exportifyCsv(rows: Array<{ name: string; artist: string; isrc?: string; uri?: string }>): string {
  const lines = [HEADER];
  for (const r of rows) {
    lines.push(`${r.name},${r.artist},Album,${r.isrc ?? ''},${r.uri ?? ''}`);
  }
  return lines.join('\n');
}

describe('importCsv (batched engine)', () => {
  it('creates new tracks and contributions for a fresh library', async () => {
    const { db } = createDb();
    const csv = exportifyCsv([
      { name: 'Song A', artist: 'Artist 1', uri: 'spotify:track:a' },
      { name: 'Song B', artist: 'Artist 2', uri: 'spotify:track:b' },
      { name: 'Song C', artist: 'Artist 3', uri: 'spotify:track:c' },
    ]);

    const result = await importCsv(envWith(db), 'contrib-1', csv, 'liked');

    expect(result.errors).toEqual([]);
    expect(result.tracks_new).toBe(3);
    expect(result.tracks_matched).toBe(0);
    expect(result.contributions_created).toBe(3);
    expect(result.contributions_skipped).toBe(0);
  });

  it('matches an existing track by ISRC instead of creating it', async () => {
    const { db } = createDb({ tracksByIsrc: { GBAYE0601498: 'existing-1' } });
    const csv = exportifyCsv([
      { name: 'Bohemian Rhapsody', artist: 'Queen', isrc: 'GBAYE0601498', uri: 'spotify:track:bo' },
    ]);

    const result = await importCsv(envWith(db), 'contrib-1', csv, 'liked');

    expect(result.tracks_new).toBe(0);
    expect(result.tracks_matched).toBe(1);
    expect(result.contributions_created).toBe(1);
  });

  it('matches an existing track by canonical title+artist', async () => {
    const canonKey = `${normalizeTitle('Song A')}|||${normalizeArtist('Artist 1')}`;
    const { db } = createDb({ tracksByCanon: { [canonKey]: 'existing-canon' } });
    const csv = exportifyCsv([{ name: 'Song A', artist: 'Artist 1', uri: 'spotify:track:a' }]);

    const result = await importCsv(envWith(db), 'contrib-1', csv, 'liked');

    expect(result.tracks_matched).toBe(1);
    expect(result.tracks_new).toBe(0);
  });

  it('dedups identical rows within the same file', async () => {
    const { db } = createDb();
    const csv = exportifyCsv([
      { name: 'Same Song', artist: 'Same Artist', uri: 'spotify:track:x' },
      { name: 'Same Song', artist: 'Same Artist', uri: 'spotify:track:x' },
    ]);

    const result = await importCsv(envWith(db), 'contrib-1', csv, 'liked');

    expect(result.tracks_new).toBe(1);
    expect(result.tracks_matched).toBe(1);
    expect(result.contributions_created).toBe(1);
    expect(result.contributions_skipped).toBe(1);
  });

  it('skips contributions that already exist in the database', async () => {
    const csv = exportifyCsv([{ name: 'Dup', artist: 'Artist', uri: 'spotify:track:d' }]);
    // Pre-seed nothing for tracks (so it creates one) but the contribution key
    // is unknown until the track id is minted — instead assert via a second import.
    const { db } = createDb({ tracksByIsrc: { ISRCDUP: 'existing-track' } });
    const csvWithIsrc = exportifyCsv([{ name: 'Dup', artist: 'Artist', isrc: 'ISRCDUP', uri: 'spotify:track:d' }]);

    const first = await importCsv(envWith(db), 'contrib-1', csvWithIsrc, 'liked');
    expect(first.contributions_created).toBe(1);

    // Same contributor, same track, same source → unique constraint blocks it.
    const second = await importCsv(envWith(db), 'contrib-1', csvWithIsrc, 'liked');
    expect(second.contributions_created).toBe(0);
    expect(second.contributions_skipped).toBe(1);
    void csv;
  });

  it('stays well under the subrequest budget for a large library', async () => {
    const { db, calls } = createDb();
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      name: `Track ${i}`,
      artist: `Artist ${i}`,
      isrc: `ISRC${i}`,
      uri: `spotify:track:id${i}`,
    }));
    const result = await importCsv(envWith(db), 'contrib-1', exportifyCsv(rows), 'liked');

    expect(result.tracks_new).toBe(2000);
    expect(result.contributions_created).toBe(2000);

    const subrequests = calls.lookups + calls.batches;
    // 2000 rows must cost far less than Cloudflare's ~1000-subrequest budget.
    expect(subrequests).toBeLessThan(300);
  });

  it('reports an unknown format without touching the database', async () => {
    const { db, calls } = createDb();
    const result = await importCsv(envWith(db), 'contrib-1', 'foo,bar\n1,2', 'liked');

    expect(result.errors[0]).toContain('Unrecognized CSV format');
    expect(calls.batches).toBe(0);
  });
});
