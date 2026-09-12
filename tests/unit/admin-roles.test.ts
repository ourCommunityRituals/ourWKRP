/**
 * Unit tests — POST /admin/roles/grant handler (F1 auth hardening).
 *
 * The endpoint is the only path that confers dj/curator. It must reject callers
 * without the admin token, reject non-privileged/malformed bodies, 404 an
 * unknown contributor, and on success write the role + a grant row.
 */
import { describe, it, expect } from 'vitest';
import { handleGrantRole } from '../../src/handlers/admin-roles';
import type { Env } from '../../src/types';

const ADMIN = 'admin-secret';
const UUID = '11111111-1111-4111-8111-111111111111';

function makeEnv(existingIds: string[]) {
  const ids = new Set(existingIds);
  const roleWrites: Array<{ id: string; role: string }> = [];
  const audits: Array<{ outcome: unknown }> = [];
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
              if (/INSERT INTO contributor_roles/.test(sql)) return { meta: { changes: 1 } };
              if (/INSERT INTO audit_events/.test(sql)) {
                audits.push({ outcome: args[7] });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
  const env = { WKRP_DB: db, WKRP_ADMIN_TOKEN: ADMIN } as unknown as Env;
  return { env, roleWrites, audits };
}

const grantReq = (body: unknown, token?: string) =>
  new Request('https://ourwkrp.com/admin/roles/grant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe('POST /admin/roles/grant', () => {
  it('rejects a caller with no admin token (401) and writes nothing', async () => {
    const { env, roleWrites } = makeEnv([UUID]);
    const res = await handleGrantRole(grantReq({ contributorId: UUID, role: 'dj' }), env);
    expect(res.status).toBe(401);
    expect(roleWrites).toHaveLength(0);
  });

  it('rejects a non-privileged role in the body (400)', async () => {
    const { env } = makeEnv([UUID]);
    const res = await handleGrantRole(grantReq({ contributorId: UUID, role: 'contributor' }, ADMIN), env);
    expect(res.status).toBe(400);
  });

  it('rejects a malformed contributorId (400)', async () => {
    const { env } = makeEnv([UUID]);
    const res = await handleGrantRole(grantReq({ contributorId: 'not-a-uuid', role: 'dj' }, ADMIN), env);
    expect(res.status).toBe(400);
  });

  it('404s when the contributor does not exist', async () => {
    const { env, roleWrites } = makeEnv([]);
    const res = await handleGrantRole(grantReq({ contributorId: UUID, role: 'curator' }, ADMIN), env);
    expect(res.status).toBe(404);
    expect(roleWrites).toHaveLength(0);
  });

  it('grants dj to an existing contributor (200) and records the role', async () => {
    const { env, roleWrites } = makeEnv([UUID]);
    const res = await handleGrantRole(grantReq({ contributorId: UUID, role: 'dj' }, ADMIN), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; contributor: { id: string; role: string } };
    expect(body.ok).toBe(true);
    expect(body.contributor).toEqual({ id: UUID, role: 'dj' });
    expect(roleWrites).toEqual([{ id: UUID, role: 'dj' }]);
  });
});
