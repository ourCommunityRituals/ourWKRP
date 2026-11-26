/**
 * POST /admin/skins/grant — turn the custom-looks add-on on or off for one
 * person (lib/skin-entitlement.ts). Gated by the WKRP admin service token
 * (admin-auth.ts), like the role grant; fails closed when the secret is unset.
 *
 * Body: { contributorId: uuid, on: boolean }
 */

import type { Env } from '../types';
import { requireAdminToken } from '../lib/admin-auth';
import { grantSkinsBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { log } from '../lib/logger';

export async function handleGrantSkins(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAdminToken(request, env);
  if (unauthorized) return unauthorized;

  const parsed = await validateBody(request, grantSkinsBodySchema);
  if (parsed instanceof Response) return parsed;
  const { contributorId, on } = parsed;

  const result = await env.WKRP_DB.prepare(
    on
      ? "UPDATE contributors SET custom_skins_since = COALESCE(custom_skins_since, datetime('now')) WHERE id = ?"
      : 'UPDATE contributors SET custom_skins_since = NULL WHERE id = ?',
  ).bind(contributorId).run();

  if (!result.meta?.changes) {
    await recordAudit(env, request, {
      action: 'admin.skins.grant', resourceType: 'contributor', resourceId: contributorId,
      outcome: 'failure', actorId: null, meta: { reason: 'no_such_contributor', on },
    });
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  log('ADMIN_SKINS_GRANT', { contributorId, on });
  await recordAudit(env, request, {
    action: 'admin.skins.grant', resourceType: 'contributor', resourceId: contributorId,
    outcome: 'success', actorId: null, meta: { on },
  });
  return Response.json({ ok: true, contributor: { id: contributorId, custom_skins: on } });
}
