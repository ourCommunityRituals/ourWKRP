/**
 * Unit tests — right-to-erasure (OW-83).
 *
 * Verifies the tombstone contract: PII columns severed while the contributor
 * row (and thus all FK-linked provenance) survives, KV identity material
 * purged, and the erasure itself audited. A miss audits a failure.
 *
 * A live DJ set ends with the erasure (OW-219): the erased person's live sets
 * end and their open playback events close, in one batch with the playback
 * close first; rows are kept, and ended sets and other DJs' sets are untouched.
 * The fake D1 below applies the two statements by their own WHERE clauses, one
 * after the other in batch order, so a reversed order or a dropped filter
 * shows in the rows. tests/integration/playback-events.test.ts runs the same
 * rule on a real D1.
 */
import { describe, it, expect } from 'vitest';
import { eraseContributor } from '../../src/lib/erasure';
import type { Env } from '../../src/types';

interface ContributorRow {
  id: string; name: string; spotify_user_id: string | null;
  spotify_display_name: string | null; apple_music_id: string | null;
  lastfm_username: string | null; status: string;
}

interface SetRow { id: string; dj_id: string; is_live: number; ended_at: string | null }
interface PlaybackRow { id: string; set_id: string; ended_at: string | null }

const NOW = 'now';

// The two statements erasure sends, matched by their full WHERE clauses: a
// statement that drops a filter matches neither and the batch throws.
const CLOSE_PLAYBACK_RE =
  /^UPDATE playback_events SET ended_at = datetime\('now'\)\s+WHERE ended_at IS NULL\s+AND set_id IN \(SELECT id FROM dj_sets WHERE dj_id = \? AND is_live = 1\)$/;
const END_SETS_RE =
  /^UPDATE dj_sets SET is_live = 0, ended_at = datetime\('now'\) WHERE dj_id = \? AND is_live = 1$/;

function makeEnv(
  seed: ContributorRow[],
  kvSeed: Record<string, string> = {},
  live: { sets?: SetRow[]; playback?: PlaybackRow[] } = {},
) {
  const contributors = new Map(seed.map((c) => [c.id, { ...c }]));
  const audit: Array<Record<string, unknown>> = [];
  const kvDeletes: string[] = [];
  const kvStore = new Map<string, string>(Object.entries(kvSeed));
  const sets = (live.sets ?? []).map((r) => ({ ...r }));
  const playback = (live.playback ?? []).map((r) => ({ ...r }));
  // Every batch erasure sends: the SQL of each statement, in order.
  const batches: string[][] = [];

  function apply(sql: string, args: unknown[]): { meta: { changes: number } } {
    const s = sql.trim();
    const djId = args[0];
    if (args.length !== 1) throw new Error(`expected one bind, got ${args.length}: ${s}`);
    if (CLOSE_PLAYBACK_RE.test(s)) {
      const liveSetIds = new Set(sets.filter((r) => r.dj_id === djId && r.is_live === 1).map((r) => r.id));
      const hit = playback.filter((p) => p.ended_at === null && liveSetIds.has(p.set_id));
      for (const p of hit) p.ended_at = NOW;
      return { meta: { changes: hit.length } };
    }
    if (END_SETS_RE.test(s)) {
      const hit = sets.filter((r) => r.dj_id === djId && r.is_live === 1);
      for (const r of hit) { r.is_live = 0; r.ended_at = NOW; }
      return { meta: { changes: hit.length } };
    }
    throw new Error(`unexpected statement in batch: ${s}`);
  }

  const db = {
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      batches.push(stmts.map((st) => st.sql.trim()));
      return stmts.map((st) => apply(st.sql, st.args));
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async run() {
              if (/UPDATE contributors/.test(sql)) {
                const id = args[args.length - 1] as string;
                const row = contributors.get(id);
                if (!row) return { meta: { changes: 0 } };
                row.name = '[erased]';
                row.spotify_user_id = null;
                row.spotify_display_name = null;
                row.apple_music_id = null;
                row.lastfm_username = null;
                row.status = 'departed';
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO audit_events/.test(sql)) {
                audit.push({
                  action: args[4], resource_id: args[6], outcome: args[7],
                  meta: args[9] === null ? null : JSON.parse(args[9] as string),
                });
                return { meta: { changes: 1 } };
              }
              // Set and playback rows change only inside a batch.
              if (/dj_sets|playback_events/.test(sql)) {
                throw new Error(`set or playback statement outside a batch: ${sql}`);
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  const kv = {
    async get(key: string) { return kvStore.get(key) ?? null; },
    async put(key: string, value: string) { kvStore.set(key, value); },
    async delete(key: string) { kvDeletes.push(key); kvStore.delete(key); },
  };

  const env = { WKRP_DB: db, WKRP_KV: kv } as unknown as Env;
  return { env, contributors, audit, kvDeletes, sets, playback, batches };
}

const seedRow = (id: string): ContributorRow => ({
  id, name: 'Matt', spotify_user_id: 'spz', spotify_display_name: 'DJ Matt',
  apple_music_id: 'am1', lastfm_username: 'mz', status: 'active',
});

const req = () => new Request('https://ourwkrp.com/api/contributors/x/identity', { method: 'DELETE' });

describe('right-to-erasure', () => {
  it('severs PII but preserves the row and id (provenance integrity)', async () => {
    const { env, contributors } = makeEnv([seedRow('c1')]);
    const result = await eraseContributor(env, req(), 'c1');

    expect(result.erased).toBe(true);
    const row = contributors.get('c1')!;
    expect(contributors.has('c1')).toBe(true); // row not deleted
    expect(row.name).toBe('[erased]');
    expect(row.spotify_user_id).toBeNull();
    expect(row.spotify_display_name).toBeNull();
    expect(row.apple_music_id).toBeNull();
    expect(row.lastfm_username).toBeNull();
    expect(row.status).toBe('departed');
  });

  it('purges KV identity material (tokens, lastfm, last_sync)', async () => {
    const { env, kvDeletes } = makeEnv([seedRow('c1')]);
    await eraseContributor(env, req(), 'c1');
    expect(kvDeletes).toContain('wkrp:tokens:c1');
    expect(kvDeletes).toContain('wkrp:lastfm:c1');
    expect(kvDeletes).toContain('wkrp:last_sync:c1');
  });

  it('audits a successful erasure', async () => {
    const { env, audit } = makeEnv([seedRow('c1')]);
    await eraseContributor(env, req(), 'c1');
    const ev = audit.find((a) => a.action === 'privacy.erasure');
    expect(ev).toBeDefined();
    expect(ev!.outcome).toBe('success');
    expect(ev!.resource_id).toBe('c1');
  });

  it('revokes all live sessions via the contributor session index (F3)', async () => {
    const { env, kvDeletes } = makeEnv([seedRow('c1')], {
      'wkrp:session_index:c1': JSON.stringify(['tokA', 'tokB']),
    });
    await eraseContributor(env, req(), 'c1');
    expect(kvDeletes).toContain('wkrp:session:tokA');
    expect(kvDeletes).toContain('wkrp:session:tokB');
    expect(kvDeletes).toContain('wkrp:session_index:c1'); // index itself dropped
  });

  it('returns erased:false and audits a failure when no row matches', async () => {
    const { env, audit, kvDeletes } = makeEnv([seedRow('c1')]);
    const result = await eraseContributor(env, req(), 'ghost');
    expect(result.erased).toBe(false);
    expect(kvDeletes).toHaveLength(0); // no KV purge on miss
    const ev = audit.find((a) => a.action === 'privacy.erasure');
    expect(ev!.outcome).toBe('failure');
  });
});

describe('right-to-erasure ends a live DJ set (OW-219)', () => {
  // dj1 is erased: one live set with an open play and a closed one, one set
  // ended earlier (its rows carry an older time). dj2 is live and stays live.
  const liveSeed = () => ({
    sets: [
      { id: 's-live', dj_id: 'c1', is_live: 1, ended_at: null },
      { id: 's-old', dj_id: 'c1', is_live: 0, ended_at: 'earlier' },
      { id: 's-other', dj_id: 'c2', is_live: 1, ended_at: null },
    ],
    playback: [
      { id: 'p-live-closed', set_id: 's-live', ended_at: 'earlier' },
      { id: 'p-live-open', set_id: 's-live', ended_at: null },
      { id: 'p-old', set_id: 's-old', ended_at: 'earlier' },
      { id: 'p-other-open', set_id: 's-other', ended_at: null },
    ],
  });

  it("ends the erased DJ's live set and closes its open playback event, keeping every row", async () => {
    const { env, sets, playback } = makeEnv([seedRow('c1'), seedRow('c2')], {}, liveSeed());
    await eraseContributor(env, req(), 'c1');

    expect(sets).toEqual([
      { id: 's-live', dj_id: 'c1', is_live: 0, ended_at: NOW },
      { id: 's-old', dj_id: 'c1', is_live: 0, ended_at: 'earlier' },
      { id: 's-other', dj_id: 'c2', is_live: 1, ended_at: null },
    ]);
    expect(playback).toEqual([
      { id: 'p-live-closed', set_id: 's-live', ended_at: 'earlier' },
      { id: 'p-live-open', set_id: 's-live', ended_at: NOW },
      { id: 'p-old', set_id: 's-old', ended_at: 'earlier' },
      { id: 'p-other-open', set_id: 's-other', ended_at: null },
    ]);
  });

  it('sends both statements in one batch, the playback close first', async () => {
    const { env, batches } = makeEnv([seedRow('c1')], {}, liveSeed());
    await eraseContributor(env, req(), 'c1');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0]).toMatch(CLOSE_PLAYBACK_RE);
    expect(batches[0][1]).toMatch(END_SETS_RE);
  });

  it('counts the sets it ended in the success audit, next to the sessions revoked', async () => {
    const { env, audit } = makeEnv([seedRow('c1')], { 'wkrp:session_index:c1': JSON.stringify(['tokA']) }, liveSeed());
    await eraseContributor(env, req(), 'c1');
    const ev = audit.find((a) => a.action === 'privacy.erasure');
    expect(ev!.meta).toEqual({ sessions_revoked: 1, live_sets_ended: 1 });
  });

  it('a DJ with no live set: nothing changes, and the audit counts 0 sets ended', async () => {
    const seed = {
      sets: [{ id: 's-old', dj_id: 'c1', is_live: 0, ended_at: 'earlier' }],
      playback: [{ id: 'p-old', set_id: 's-old', ended_at: 'earlier' }],
    };
    const { env, sets, playback, audit } = makeEnv([seedRow('c1')], {}, seed);
    await eraseContributor(env, req(), 'c1');
    expect(sets).toEqual(seed.sets);
    expect(playback).toEqual(seed.playback);
    expect(audit.find((a) => a.action === 'privacy.erasure')!.meta).toEqual({ sessions_revoked: 0, live_sets_ended: 0 });
  });

  it('a miss ends no set and sends no batch', async () => {
    const { env, sets, batches, audit } = makeEnv([seedRow('c1')], {}, liveSeed());
    await eraseContributor(env, req(), 'ghost');
    expect(batches).toHaveLength(0);
    expect(sets.filter((r) => r.is_live === 1).map((r) => r.id)).toEqual(['s-live', 's-other']);
    expect(audit.find((a) => a.action === 'privacy.erasure')!.meta).toEqual({ reason: 'no_such_contributor' });
  });
});
