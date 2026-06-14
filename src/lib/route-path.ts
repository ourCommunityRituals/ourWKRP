/**
 * Pure path-parsing helpers for the router.
 *
 * The request path is fully attacker-controlled. These helpers extract a path
 * segment between a fixed prefix/suffix and (for UUID routes) gate it against
 * the canonical UUID shape before any handler touches the DB. Pure + total:
 * they never throw and return null on any non-match, so they are fuzzable in
 * isolation without an Env/DB mock.
 */

export const UUID_RE = /^[0-9a-f-]{36}$/;

/** Extract the segment between `prefix` and `suffix`, or null if path doesn't fit. */
export function extractSegment(path: string, prefix: string, suffix = ''): string | null {
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const end = path.length - suffix.length;
  // Guard against overlap (prefix and suffix sharing characters in a short path).
  if (end < prefix.length) return null;
  return path.slice(prefix.length, end);
}

/** Like extractSegment, but only returns the segment when it is a valid UUID. */
export function extractUuid(path: string, prefix: string, suffix = ''): string | null {
  const id = extractSegment(path, prefix, suffix);
  if (id === null || !UUID_RE.test(id)) return null;
  return id;
}
