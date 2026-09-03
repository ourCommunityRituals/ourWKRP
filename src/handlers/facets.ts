/**
 * Flag facet handlers — a contributor's self-declared (domain, depth) pairs.
 *
 * POST   /api/facets        — declare (or re-depth) a domain (authed)
 * DELETE /api/facets/:id    — remove one facet (authed, owner)
 *
 * Facets also fold into the public contributor profile payload
 * (GET /api/contributors/:id) alongside roles — see handleGetContributorProfile.
 *
 * Scope note (HL-P3.2 / OW-121): a facet is purely additive self-description.
 * It is deliberately ADR-independent — no container, no owner_ref, no visibility
 * scope, no cross-product seam. A person declaring "(domain, depth)" about
 * themselves, and nothing more.
 */

import type { Env, FlagFacet } from '../types';
import { requireSession } from '../lib/require-session';
import { facetBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { log } from '../lib/logger';

/**
 * POST /api/facets — declare a (domain, depth) facet for the authenticated
 * contributor. Upsert on (contributor_id, domain): re-declaring a domain with a
 * different depth updates the existing row rather than creating a duplicate, so
 * changing depth is idempotent. One depth per domain per person.
 */
export async function handleDeclareFacet(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, facetBodySchema);
  if (parsed instanceof Response) return parsed;

  // Advisory pre-check: distinguishes a create (201) from a re-depth (200). The
  // write itself is an atomic upsert against the UNIQUE (contributor_id, domain)
  // index, so it stays correct even if this read races a concurrent declare.
  const existing = await env.WKRP_DB.prepare(
    'SELECT id FROM flag_facets WHERE contributor_id = ? AND domain = ?',
  ).bind(auth.userId, parsed.domain).first<{ id: string }>();

  const id = existing?.id ?? crypto.randomUUID();

  await env.WKRP_DB.prepare(`
    INSERT INTO flag_facets (id, contributor_id, domain, depth, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (contributor_id, domain) DO UPDATE SET depth = excluded.depth
  `).bind(id, auth.userId, parsed.domain, parsed.depth).run();

  const row = await env.WKRP_DB.prepare(
    'SELECT id, contributor_id, domain, depth, created_at FROM flag_facets WHERE contributor_id = ? AND domain = ?',
  ).bind(auth.userId, parsed.domain).first<FlagFacet>();

  log(existing ? 'FACET_REDEPTHED' : 'FACET_DECLARED', {
    id: row!.id, contributor: auth.userId, domain: parsed.domain, depth: parsed.depth,
  });

  return Response.json({ ok: true, facet: row }, { status: existing ? 200 : 201 });
}

/** DELETE /api/facets/:id — remove a facet the authenticated contributor owns. */
export async function handleRemoveFacet(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const row = await env.WKRP_DB.prepare(
    'SELECT contributor_id FROM flag_facets WHERE id = ?',
  ).bind(id).first<{ contributor_id: string }>();

  if (!row) {
    return Response.json({ ok: false, error: 'Facet not found' }, { status: 404 });
  }
  if (row.contributor_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your facet' }, { status: 403 });
  }

  await env.WKRP_DB.prepare('DELETE FROM flag_facets WHERE id = ?').bind(id).run();
  log('FACET_REMOVED', { id, contributor: auth.userId });

  return Response.json({ ok: true, removed: id });
}
