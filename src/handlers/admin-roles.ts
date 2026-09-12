/**
 * POST /admin/roles/grant  (F1 auth hardening)
 *
 * Confer a privileged role (dj/curator) on an existing contributor. This is the
 * only route by which a privileged role is assigned — self-service register can
 * only mint contributor/listener. Gated by the WKRP admin service token
 * (admin-auth.ts), not a session, and fails closed when the secret is unset.
 *
 * Body: { contributorId: uuid, role: 'dj' | 'curator' }
 */

import type { Env } from '../types';
import { requireAdminToken } from '../lib/admin-auth';
import { grantPrivilegedRole } from '../lib/roles';
import { grantRoleBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { log } from '../lib/logger';

export async function handleGrantRole(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdminToken(request, env);
  if (unauthorized) return unauthorized;

  const parsed = await validateBody(request, grantRoleBodySchema);
  if (parsed instanceof Response) return parsed;
  const { contributorId, role } = parsed;

  const granted = await grantPrivilegedRole(env, contributorId, role);

  if (!granted) {
    await recordAudit(env, request, {
      action: 'admin.role.grant', resourceType: 'contributor', resourceId: contributorId,
      outcome: 'failure', actorId: null, meta: { reason: 'no_such_contributor', role },
    });
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  log('ADMIN_ROLE_GRANT', { contributorId, role });
  await recordAudit(env, request, {
    action: 'admin.role.grant', resourceType: 'contributor', resourceId: contributorId,
    outcome: 'success', actorId: null, meta: { role },
  });
  return Response.json({ ok: true, contributor: { id: contributorId, role } }, { status: 200 });
}
