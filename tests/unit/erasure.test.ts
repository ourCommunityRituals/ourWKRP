/**
 * Unit tests — right-to-erasure (OW-83).
 *
 * Verifies the tombstone contract: PII columns severed while the contributor
 * row (and thus all FK-linked provenance) survives, KV identity material
 * purged, and the erasure itself audited. A miss audits a failure.
 */
import { describe, it, expect } from 'vitest';
import { eraseContributor } from '../../src/lib/erasure';
import type { Env } from '../../src/types';

interface ContributorRow {
  id: string; name: string; spotify_user_id: string | null;
  spotify_display_name: string | null; apple_music_id: string | null;
  lastfm_username: string | null; status: string;
}

function makeEnv(seed: ContributorRow[]) {
  const contributors = new Map(seed.map((c) => [c.id, { ...c }]));
  const audit: Array<Record<string, unknown>> = [];
  const kvDeletes: string[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
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
                audit.push({ action: args[4], resource_id: args[6], outcome: args[7] });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  const kv = {
    async delete(key: string) { kvDeletes.push(key); },
  };

  const env = { WKRP_DB: db, WKRP_KV: kv } as unknown as Env;
  return { env, contributors, audit, kvDeletes };
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

  it('returns erased:false and audits a failure when no row matches', async () => {
    const { env, audit, kvDeletes } = makeEnv([seedRow('c1')]);
    const result = await eraseContributor(env, req(), 'ghost');
    expect(result.erased).toBe(false);
    expect(kvDeletes).toHaveLength(0); // no KV purge on miss
    const ev = audit.find((a) => a.action === 'privacy.erasure');
    expect(ev!.outcome).toBe('failure');
  });
});
