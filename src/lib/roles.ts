/**
 * Role taxonomy + self-assignment policy (F1 auth hardening, 2026-09-12).
 *
 * WKRP roles gate real capabilities server-side:
 *   - `dj`      → start live sets + record attributions (handlers/dj.ts)
 *   - `curator` → restricted catalog visibility (handlers/catalog.ts) and is
 *                 accepted by the export / playlist role gates
 * Those are PRIVILEGED roles. They must never be self-assignable through the
 * anonymous sign-up paths (/auth/register, /auth/start) — otherwise any client
 * could POST `{ role: 'dj' }`, receive a session, and clear every role gate.
 *
 * Self-service sign-up may therefore only mint the two unprivileged roles.
 * Privileged roles are conferred out-of-band via grantPrivilegedRole(), the
 * single auditable choke point, which is intentionally NOT wired to any public
 * route — wiring it requires an authenticated admin/verification gate.
 */

import type { Env } from '../types';

export const SELF_ASSIGNABLE_ROLES = ['contributor', 'listener'] as const;
export const PRIVILEGED_ROLES = ['dj', 'curator'] as const;

export type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];
export type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number];
export type Role = SelfAssignableRole | PrivilegedRole;

/** True only for roles a client is allowed to assign itself at sign-up. */
export function isSelfAssignableRole(role: unknown): role is SelfAssignableRole {
  return typeof role === 'string' && (SELF_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** True for roles that must be conferred through grantPrivilegedRole(). */
export function isPrivilegedRole(role: unknown): role is PrivilegedRole {
  return typeof role === 'string' && (PRIVILEGED_ROLES as readonly string[]).includes(role);
}

/**
 * Confer a privileged role on an existing contributor. This is the ONLY code
 * path by which `dj` / `curator` may be assigned, so every privileged grant
 * flows through one auditable place. Its sole caller is handleGrantRole
 * (POST /admin/roles/grant), which establishes admin authority via the WKRP
 * admin token (admin-auth.ts) first. Returns false if no contributor matched.
 */
export async function grantPrivilegedRole(
  env: Env,
  contributorId: string,
  role: PrivilegedRole,
): Promise<boolean> {
  const res = await env.WKRP_DB.prepare(
    'UPDATE contributors SET role = ? WHERE id = ?',
  )
    .bind(role, contributorId)
    .run();

  if ((res?.meta?.changes ?? 0) === 0) return false;

  await env.WKRP_DB.prepare(
    'INSERT INTO contributor_roles (contributor_id, role, granted_at) VALUES (?, ?, datetime(\'now\'))',
  )
    .bind(contributorId, role)
    .run();

  return true;
}
