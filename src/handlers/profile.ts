/**
 * Profile mutation handlers (OW-122, HL-P3.3).
 *
 * POST /api/profile/slug — claim or change the authenticated contributor's
 *                          vanity slug, which powers /c/:slug.
 *
 * Scope note: this is public-flag polish. It touches the contributor's own
 * presentation only — no visibility/unlisted semantics, no owner_ref, no
 * cross-product surface.
 */

import type { Env } from '../types';
import { requireSession } from '../lib/require-session';
import { claimSlugBodySchema, setProfileTypeBodySchema, setVotableBodySchema, layoutBodySchema } from '../lib/schemas';
import { parseSkinMarkdown, writeSkinMarkdown } from '../lib/layout-skin-md';
import { SURFACES, cleanLayout, defaultLayout, type Layout } from '../lib/layout-skins';
import { ADD_ON_MESSAGE, BASE_SKIN, hasCustomSkins } from '../lib/skin-entitlement';
import { validateBody } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { log } from '../lib/logger';

interface SlugOwnerRow {
  brand_id: string;
  slug: string | null;
  slug_locked: number;
}

/**
 * POST /api/profile/slug — body { slug }.
 *
 * Status contract:
 *   200 — claimed or changed
 *   400 — malformed or reserved slug (from claimSlugBodySchema)
 *   401 — no session
 *   403 — slug_locked is set; the owner may no longer change it
 *   404 — session points at a contributor row that no longer exists
 *   409 — another contributor in the same brand already holds the slug
 *
 * 403 vs 409 is a deliberate split: 409 means "taken by someone else, pick
 * another", 403 means "yours, but frozen". Collapsing both to one status would
 * make the two indistinguishable to a client that needs to say different things.
 */
export async function handleClaimProfileSlug(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, claimSlugBodySchema);
  if (parsed instanceof Response) return parsed;

  const { slug } = parsed;

  const owner = await env.WKRP_DB.prepare(
    'SELECT brand_id, slug, slug_locked FROM contributors WHERE id = ?',
  ).bind(auth.userId).first<SlugOwnerRow>();

  if (!owner) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  // Idempotent: re-claiming the slug you already hold is a no-op success, even
  // when locked — the caller is not asking for a change.
  if (owner.slug === slug) {
    return Response.json({ ok: true, slug, slug_locked: owner.slug_locked });
  }

  // Lock check. Mirrors OSE's events.slug_locked meaning ("prevents marketing
  // URL changes after first scan"): the flag is set by a lifecycle event
  // elsewhere, and once set the URL is frozen because it is already in print.
  if (owner.slug_locked) {
    await recordAudit(env, request, {
      action: 'profile.slug.claim',
      resourceType: 'contributor',
      resourceId: auth.userId,
      outcome: 'denied',
      actorId: auth.userId,
      brandId: owner.brand_id,
      meta: { reason: 'slug_locked' },
    });
    return Response.json(
      { ok: false, error: 'This profile URL is locked and can no longer be changed' },
      { status: 403 },
    );
  }

  // Uniqueness is enforced by idx_contributors_brand_slug (migration 0010), not
  // by a read-then-write check: a SELECT-before-UPDATE would race two
  // simultaneous claims into the same slug. We attempt the write and let the
  // index be the arbiter.
  try {
    await env.WKRP_DB.prepare(
      'UPDATE contributors SET slug = ? WHERE id = ?',
    ).bind(slug, auth.userId).run();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      await recordAudit(env, request, {
        action: 'profile.slug.claim',
        resourceType: 'contributor',
        resourceId: auth.userId,
        outcome: 'failure',
        actorId: auth.userId,
        brandId: owner.brand_id,
        meta: { reason: 'slug_taken' },
      });
      return Response.json(
        { ok: false, error: 'That profile URL is already taken' },
        { status: 409 },
      );
    }
    throw err;
  }

  await recordAudit(env, request, {
    action: 'profile.slug.claim',
    resourceType: 'contributor',
    resourceId: auth.userId,
    outcome: 'success',
    actorId: auth.userId,
    brandId: owner.brand_id,
    meta: { had_previous_slug: owner.slug !== null },
  });

  log('PROFILE_SLUG_CLAIMED', { contributor: auth.userId, brand_id: owner.brand_id });

  return Response.json({ ok: true, slug, slug_locked: owner.slug_locked });
}

/**
 * D1 surfaces a violated UNIQUE index as a driver error string rather than a
 * typed error, so the message is the only signal available. Matched loosely
 * (both "UNIQUE constraint failed" and the bare SQLITE_CONSTRAINT code) so a
 * driver wording change degrades to a 500 rather than a wrong 409.
 */
function isUniqueConstraintError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(msg);
}

/**
 * POST /api/profile/type — body { profile_type: 'artist' | 'sports' | null }.
 *
 * The signed-in contributor sets, changes or clears their own profile type
 * (profiles-and-voting design, story 2; migration 0014).
 *
 * Status contract:
 *   200 — set (or already that value)
 *   400 — not a launch type (from setProfileTypeBodySchema)
 *   401 — no session
 *   404 — session points at a contributor row that no longer exists
 */
export async function handleSetProfileType(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, setProfileTypeBodySchema);
  if (parsed instanceof Response) return parsed;

  const profileType = parsed.profile_type;
  const result = await env.WKRP_DB.prepare(
    'UPDATE contributors SET profile_type = ? WHERE id = ?',
  ).bind(profileType, auth.userId).run();

  if (!result.meta?.changes) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  await recordAudit(env, request, {
    action: 'profile.type.set',
    resourceType: 'contributor',
    resourceId: auth.userId,
    outcome: 'success',
    actorId: auth.userId,
    meta: { profile_type: profileType },
  });
  log('PROFILE_TYPE_SET', { contributorId: auth.userId, profileType });

  return Response.json({ ok: true, profile_type: profileType });
}

/**
 * POST /api/profile/votable — body { votable: boolean }.
 *
 * "People may vote for me" (profiles-and-voting design, story 3; migration
 * 0015). Off by default. The signed-in contributor opts in, which records the
 * date, or withdraws, which clears it. Only an opted-in profile may be put on
 * an event's vote set. Erasure clears it too (lib/erasure.ts).
 *
 * Opting in again while already opted in keeps the first date.
 *
 * Status contract:
 *   200 — { ok, votable }
 *   400 — votable missing or not a boolean
 *   401 — no session
 *   404 — session points at a contributor row that no longer exists
 */
export async function handleSetVotable(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, setVotableBodySchema);
  if (parsed instanceof Response) return parsed;

  const votable = parsed.votable;
  const result = await env.WKRP_DB.prepare(
    votable
      ? "UPDATE contributors SET votable_since = COALESCE(votable_since, datetime('now')) WHERE id = ?"
      : 'UPDATE contributors SET votable_since = NULL WHERE id = ?',
  ).bind(auth.userId).run();

  if (!result.meta?.changes) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  await recordAudit(env, request, {
    action: votable ? 'profile.votable.opt_in' : 'profile.votable.withdraw',
    resourceType: 'contributor',
    resourceId: auth.userId,
    outcome: 'success',
    actorId: auth.userId,
  });
  log('PROFILE_VOTABLE_SET', { contributorId: auth.userId, votable });

  return Response.json({ ok: true, votable });
}

/**
 * The stored profile layout, checked again on the way out, or the standard
 * skin when there is none (or what is stored no longer passes the checks).
 * Used by the public profile read too (handlers/catalog.ts).
 *
 * Without the custom-looks add-on (lib/skin-entitlement.ts) this is always
 * the standard skin, so taking the add-on away puts the base look back.
 */
export function readProfileLayout(stored: unknown, entitled: boolean): Layout {
  if (entitled && typeof stored === 'string' && stored) {
    try {
      const layout = cleanLayout(JSON.parse(stored));
      if (layout && layout.surface === 'profile') return layout;
    } catch {
      // Unreadable JSON falls back to the standard skin.
    }
  }
  return defaultLayout('profile');
}

/** What the editor needs to draw its controls. */
function editorOptions() {
  const def = SURFACES.profile;
  return { parts: def.parts, required: def.required, labels: def.labels, skins: def.skins };
}

/**
 * GET /api/profile/layout — the signed-in contributor's own profile skin.
 *
 * Status contract:
 *   200 — { ok, layout, markdown, options }
 *   401 — no session
 *   404 — session points at a contributor row that no longer exists
 */
export async function handleGetProfileLayout(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const row = await env.WKRP_DB.prepare(
    'SELECT profile_layout FROM contributors WHERE id = ?',
  ).bind(auth.userId).first<{ profile_layout: string | null }>();
  if (!row) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  const entitled = await hasCustomSkins(env, auth.userId);
  const layout = readProfileLayout(row.profile_layout, entitled);
  return Response.json({
    ok: true, layout, markdown: writeSkinMarkdown(layout), options: editorOptions(),
    entitled, base_skin: BASE_SKIN, add_on_message: ADD_ON_MESSAGE,
  });
}

/**
 * PUT /api/profile/layout — body { markdown }: save the signed-in
 * contributor's profile skin from a skin file (lib/layout-skin-md.ts).
 *
 * Only the arrangement is stored; the file's notes are not. A skin cannot
 * carry colors, sizes, markup, links or counts, so it cannot lower contrast
 * or show a count under the floor of 5.
 *
 * Status contract:
 *   200 — { ok, layout, markdown }
 *   400 — not a valid skin file: { ok: false, error, problems: string[] }
 *   401 — no session
 *   403 — a skin other than standard without the custom-looks add-on
 *   404 — session points at a contributor row that no longer exists
 */
export async function handlePutProfileLayout(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, layoutBodySchema);
  if (parsed instanceof Response) return parsed;

  const skin = parseSkinMarkdown(parsed.markdown);
  if (!skin.ok) {
    return Response.json(
      { ok: false, error: 'That skin file cannot be used', problems: skin.problems },
      { status: 400 },
    );
  }
  if (skin.layout.surface !== 'profile') {
    return Response.json(
      { ok: false, error: 'That skin file cannot be used', problems: ['"surface" must be profile for your profile page.'] },
      { status: 400 },
    );
  }

  const layout = skin.layout;
  // The base skin is free for everyone; anything else is the add-on.
  if (layout.skin !== BASE_SKIN && !(await hasCustomSkins(env, auth.userId))) {
    await recordAudit(env, request, {
      action: 'profile.layout.set', resourceType: 'contributor', resourceId: auth.userId,
      outcome: 'denied', actorId: auth.userId, meta: { reason: 'no_custom_skins', skin: layout.skin },
    });
    return Response.json(
      { ok: false, error: ADD_ON_MESSAGE, problems: [ADD_ON_MESSAGE], entitled: false },
      { status: 403 },
    );
  }
  const result = await env.WKRP_DB.prepare(
    'UPDATE contributors SET profile_layout = ? WHERE id = ?',
  ).bind(JSON.stringify(layout), auth.userId).run();

  if (!result.meta?.changes) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  await recordAudit(env, request, {
    action: 'profile.layout.set',
    resourceType: 'contributor',
    resourceId: auth.userId,
    outcome: 'success',
    actorId: auth.userId,
    meta: { skin: layout.skin, columns: layout.columns },
  });
  log('PROFILE_LAYOUT_SET', { contributorId: auth.userId, skin: layout.skin });

  return Response.json({ ok: true, layout, markdown: writeSkinMarkdown(layout) });
}
