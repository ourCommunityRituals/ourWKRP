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

/**
 * GET /api/me/export — "Download my data" (GDPR Art. 15 access, Art. 20
 * portability). Self-only by construction: the contributor id comes from the
 * session, never from the URL, so there is no id to swap.
 *
 * Returns one JSON file of everything held about the signed-in contributor:
 * the profile row, roles, declared domains, playlists, preferred playlists,
 * linked accounts (never the tokens, which live in KV and stay there), the
 * tracks they brought, DJ sets, and their own audit events. Each query reads
 * by the session's id only. A failed section is reported as an error string
 * instead of failing the whole download.
 */
const EXPORT_QUERIES: ReadonlyArray<[section: string, sql: string]> = [
  ['profile', 'SELECT * FROM contributors WHERE id = ?'],
  ['roles', 'SELECT role, granted_at FROM contributor_roles WHERE contributor_id = ?'],
  ['declared_domains', 'SELECT id, domain, depth, created_at FROM flag_facets WHERE contributor_id = ?'],
  ['playlists', 'SELECT id, name, description, track_count, is_curated, brand_id, created_at FROM playlists WHERE contributor_id = ?'],
  ['preferred_playlists', 'SELECT platform, url, title, position, created_at FROM preferred_playlists WHERE contributor_id = ?'],
  ['linked_accounts', 'SELECT platform, platform_user_id, role, status, display_name, created_at FROM linked_accounts WHERE contributor_id = ?'],
  [
    'tracks_brought',
    `SELECT c.track_id, t.name AS track_name, t.artist AS artist, c.source_type, c.source_name,
            c.source_platform, c.play_count, c.first_listened_at, c.added_at, c.created_at
       FROM contributions c LEFT JOIN tracks t ON t.id = c.track_id
      WHERE c.contributor_id = ?`,
  ],
  ['dj_sets', 'SELECT id, event_id, venue_name, started_at, ended_at, is_live FROM dj_sets WHERE dj_id = ?'],
  ['activity_log', 'SELECT ts, action, resource_type, resource_id, outcome FROM audit_events WHERE actor_id = ? ORDER BY ts, id'],
];

export async function handleExportMyData(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const id = session.userId;

  const data: Record<string, unknown> = {};
  for (const [section, sql] of EXPORT_QUERIES) {
    try {
      const res = await env.WKRP_DB.prepare(sql).bind(id).all();
      const rows = res.results ?? [];
      data[section] = section === 'profile' ? (rows[0] ?? null) : rows;
    } catch {
      data[section] = { error: 'could not be read; email privacy@oursharedevents.com' };
    }
  }

  await recordAudit(env, request, {
    action: 'privacy.export',
    resourceType: 'contributor',
    resourceId: id,
    outcome: 'success',
    actorId: id,
  });

  const body = JSON.stringify(
    {
      about:
        'Everything ourWKRP holds about you, as of exported_at. Sign-in tokens are not included. ' +
        'Questions: privacy@oursharedevents.com. Privacy page: /privacy',
      exported_at: new Date().toISOString(),
      contributor_id: id,
      ...data,
    },
    null,
    2,
  );
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="my-ourwkrp-data.json"',
      'Cache-Control': 'no-store',
    },
  });
}
