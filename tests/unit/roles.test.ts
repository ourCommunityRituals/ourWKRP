/**
 * Unit tests — role taxonomy + self-assignment policy (F1 auth hardening).
 *
 * The security property: `dj`/`curator` pass server-side authz gates
 * (handlers/dj.ts, catalog.ts), so they must be classed privileged and never
 * self-assignable. grantPrivilegedRole is the single choke point that confers
 * them, and only touches an existing contributor.
 */
import { describe, it, expect } from 'vitest';
import {
  SELF_ASSIGNABLE_ROLES,
  PRIVILEGED_ROLES,
  isSelfAssignableRole,
  isPrivilegedRole,
  grantPrivilegedRole,
} from '../../src/lib/roles';
import type { Env } from '../../src/types';

describe('role taxonomy', () => {
  it('classes contributor/listener as self-assignable, dj/curator as privileged', () => {
    expect([...SELF_ASSIGNABLE_ROLES]).toEqual(['contributor', 'listener']);
    expect([...PRIVILEGED_ROLES]).toEqual(['dj', 'curator']);
  });

  it('the two sets are disjoint (no role is both self-assignable and privileged)', () => {
    for (const r of PRIVILEGED_ROLES) expect(isSelfAssignableRole(r)).toBe(false);
    for (const r of SELF_ASSIGNABLE_ROLES) expect(isPrivilegedRole(r)).toBe(false);
  });

  it('isSelfAssignableRole rejects privileged and unknown roles', () => {
    expect(isSelfAssignableRole('contributor')).toBe(true);
    expect(isSelfAssignableRole('listener')).toBe(true);
    expect(isSelfAssignableRole('dj')).toBe(false);
    expect(isSelfAssignableRole('curator')).toBe(false);
    expect(isSelfAssignableRole('admin')).toBe(false);
    expect(isSelfAssignableRole(undefined)).toBe(false);
    expect(isSelfAssignableRole(null)).toBe(false);
  });
});

function makeEnv(existingIds: string[]) {
  const roleWrites: Array<{ id: string; role: string }> = [];
  const roleGrants: Array<{ id: string; role: string }> = [];
  const ids = new Set(existingIds);
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/UPDATE contributors SET role/.test(sql)) {
                const [role, id] = args as [string, string];
                if (!ids.has(id)) return { meta: { changes: 0 } };
                roleWrites.push({ id, role });
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO contributor_roles/.test(sql)) {
                const [id, role] = args as [string, string];
                roleGrants.push({ id, role });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  const env = { WKRP_DB: db } as unknown as Env;
  return { env, roleWrites, roleGrants };
}

describe('grantPrivilegedRole', () => {
  it('confers the role on an existing contributor and records the grant', async () => {
    const { env, roleWrites, roleGrants } = makeEnv(['c1']);
    const ok = await grantPrivilegedRole(env, 'c1', 'dj');
    expect(ok).toBe(true);
    expect(roleWrites).toEqual([{ id: 'c1', role: 'dj' }]);
    expect(roleGrants).toEqual([{ id: 'c1', role: 'dj' }]);
  });

  it('returns false and records nothing when the contributor does not exist', async () => {
    const { env, roleGrants } = makeEnv([]);
    const ok = await grantPrivilegedRole(env, 'ghost', 'curator');
    expect(ok).toBe(false);
    expect(roleGrants).toHaveLength(0); // no dangling grant row for a missing user
  });
});
