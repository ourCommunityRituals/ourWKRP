/**
 * DELETE /api/contributors/:id/identity — self-service right-to-erasure (OW-83).
 *
 * Authorization: self-only. A valid session is required and its userId must
 * equal the target id — a contributor may erase themselves, nobody else. A
 * cross-id attempt is audited as `denied`. (An admin-initiated erasure path is
 * deferred until a role/authz model exists.)
 *
 * On success the session is also destroyed and its cookie cleared, since the
 * identity it pointed at no longer exists.
 */

import type { Env } from '../types';
import { requireSession } from '../lib/require-session';
import { getSessionToken, buildClearSessionCookie } from '../lib/session-cookie';
import { deleteSession } from '../lib/kv-storage';
import { eraseContributor } from '../lib/erasure';
import { recordAudit } from '../lib/audit';

export async function handleEraseIdentity(
  request: Request,
  env: Env,
  contributorId: string,
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  if (session.userId !== contributorId) {
    await recordAudit(env, request, {
      action: 'privacy.erasure',
      resourceType: 'contributor',
      resourceId: contributorId,
      outcome: 'denied',
      actorId: session.userId,
      meta: { reason: 'not_self' },
    });
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const result = await eraseContributor(env, request, contributorId);
  if (!result.erased) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  // Tear down the now-orphaned session.
  const token = getSessionToken(request);
  if (token) await deleteSession(env.WKRP_KV, token);

  return new Response(JSON.stringify({ ok: true, erased: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearSessionCookie(),
    },
  });
}
