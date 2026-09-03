/**
 * Vanity slug rules (OW-122, HL-P3.3).
 *
 * A slug is the human-readable half of a contributor's public URL: /c/:slug
 * resolves to the same profile page as /contributor/:uuid. Because a slug
 * occupies a *top-level* path segment, an unconstrained slug could shadow a
 * real route — a contributor claiming "api" would make /c/api harmless but
 * would invite exactly the kind of namespace confusion that breaks links when
 * the vanity namespace is ever flattened to /:slug. The denylist below closes
 * that door now, while the namespace is still cheap to reason about.
 *
 * Pure and dependency-free so the shape rules stay fuzzable/unit-testable in
 * isolation, matching lib/route-path.ts.
 */

/**
 * Shape: 2–64 characters, lowercase alphanumerics and hyphens, no leading or
 * trailing hyphen. Deliberately stricter than lib/brand.ts's `/^[a-z0-9-]+$/`
 * (which permits `-foo-`) because a slug is user-chosen rather than
 * operator-configured. Uppercase is rejected outright rather than folded, so
 * one slug never has two spellings.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 64;

/**
 * Every top-level path segment the router dispatches on, so no slug can shadow
 * a route. Derived mechanically from src/router.ts — a unit test re-derives the
 * list from the router source and fails if a new route lands without being
 * reserved here, so this cannot silently drift.
 *
 * "ui.css" can never match SLUG_RE (no dots are allowed), and "c" is the vanity
 * namespace itself; both are listed anyway so the set reads as a complete
 * inventory of taken names rather than a filtered one.
 */
export const ROUTE_RESERVED_SLUGS = [
  'api',
  'auth',
  'c',
  'catalog',
  'contributor',
  'create',
  'dashboard',
  'dj',
  'health',
  'import',
  'lastfm',
  'spotify',
  'stats',
  'ui.css',
] as const;

/**
 * Names with no route today that must not be handed out: conventional
 * infrastructure paths and the shared @ocr/ui preview surface other products in
 * the fleet expose. Reserving them costs nothing now and avoids having to
 * revoke someone's URL later.
 */
export const FUTURE_RESERVED_SLUGS = [
  'about',
  'admin',
  'assets',
  'login',
  'logout',
  'privacy',
  'settings',
  'static',
  'support',
  'terms',
  'ui-preview',
  'www',
] as const;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set<string>([
  ...ROUTE_RESERVED_SLUGS,
  ...FUTURE_RESERVED_SLUGS,
]);

/** True when `slug` is a name the platform keeps for itself. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/** True when `slug` is well-formed AND not reserved — the full claim rule. */
export function isClaimableSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !isReservedSlug(slug);
}
