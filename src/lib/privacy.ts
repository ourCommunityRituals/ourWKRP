/**
 * Privacy boundary — ourWKRP's consent-based tracking model
 *
 * ourWKRP is a non-anonymous, opted-in network. Every contributor
 * chose to be here and chose what to share. This is the opposite
 * of OurSharedEvents, which is anonymous by default.
 *
 * The privacy boundary:
 *   - WITHIN ourWKRP: full identity, attribution, tracking (user consented)
 *   - CROSSING TO OSE: aggregate only, no PII, no listener identities
 *   - OurRecordStories: the bridge where individuals choose to connect
 *     their WKRP identity to their OSE presence
 *
 * Group vs Individual:
 *   - Group at OSE event → anonymous, headcount only
 *   - Individual scans WKRP QR → opted in, tracked with perks
 *   - The act of scanning IS the consent
 *
 * Rules:
 *   1. Never expose listener identity (listener_id/name/email) in cross-product
 *      APIs. Presenter/contributor names (DJs, curators) are the NAMED POLE —
 *      they opted into public attribution and may cross — but any listener-derived
 *      COUNT that crosses takes the uniform floor (see count-floor.ts).
 *   2. Sponsor reports show aggregates, not individual listeners
 *   3. OSE integration returns music data (tracks, DJs) but not listener data
 *   4. Individual tracking data stays within ourWKRP unless the user
 *      explicitly connects their identity via OurRecordStories
 */

/**
 * Strip PII from data before it crosses the privacy boundary to OSE.
 * Keeps music data (tracks, DJs, counts) but removes listener identity.
 */
export function stripListenerPII<T extends Record<string, unknown>>(record: T): T {
  const cleaned = { ...record };
  delete cleaned.listener_id;
  delete cleaned.listener_name;
  delete cleaned.listener_email;
  return cleaned;
}

/**
 * Sanitize an array of records for cross-product export.
 */
export function sanitizeForExport<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.map(stripListenerPII);
}

/**
 * Check if a data request is crossing the privacy boundary.
 * Cross-product requests come from OSE or external systems.
 *
 * NOTE: presence is NOT authorization. This only detects that a request LOOKS
 * cross-product (origin/header shape); it does not prove the caller holds the
 * service secret. Gate egress with verifyCrossProductToken(), never with this.
 */
export function isCrossProductRequest(request: Request): boolean {
  // Check for OSE integration header or external origin
  const origin = request.headers.get('Origin') || '';
  const isOSE = origin.includes('oursharedevents.com');
  const hasIntegrationKey = request.headers.get('X-OSE-Integration') !== null;
  return isOSE || hasIntegrationKey;
}

/**
 * Coarsen DJ set rows before they cross the cross-product boundary (OSE-1299).
 *
 * The music seam returns per-set rows alongside a sibling sponsor attendance
 * timeline. Two residual fields on each set are a re-association (differencing)
 * vector when aligned against that timeline:
 *
 *   - `track_count`: a per-set small-integer fingerprint. The aggregate
 *     `top_tracks` already conveys the music content, so this is DROPPED
 *     entirely — flooring a per-set integer would still leak "which set".
 *   - `started_at` / `ended_at`: precise timestamps let an attacker ask "which
 *     set was active during this low-attendance HOUR" and re-associate a
 *     floored/dropped cohort with a named DJ + venue + time. Hour granularity
 *     does NOT defeat that alignment, so timestamps are COARSENED to date
 *     (YYYY-MM-DD).
 *
 * The DJ name/id (named pole) and the set identity/ordering are preserved.
 */
export function coarsenSets<T extends Record<string, unknown>>(rows: T[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    // Drop the per-set small-integer fingerprint entirely.
    delete out.track_count;
    // Coarsen timestamps to date granularity (YYYY-MM-DD) or drop if absent.
    out.started_at = coarsenToDate(row.started_at);
    out.ended_at = coarsenToDate(row.ended_at);
    return out;
  });
}

/**
 * Coarsen a timestamp-ish value to date granularity (YYYY-MM-DD).
 * Returns null for null/undefined/unparseable input (never widens precision).
 */
function coarsenToDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  // Match a leading ISO/SQL date; ignore any time component that follows.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // Fall back to Date parsing for other shapes; drop if unparseable.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
