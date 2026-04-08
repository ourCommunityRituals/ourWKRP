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
 *   1. Never expose listener_id or contributor names in cross-product APIs
 *   2. Sponsor reports show aggregates, not individuals
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
 */
export function isCrossProductRequest(request: Request): boolean {
  // Check for OSE integration header or external origin
  const origin = request.headers.get('Origin') || '';
  const isOSE = origin.includes('oursharedevents.com');
  const hasIntegrationKey = request.headers.get('X-OSE-Integration') !== null;
  return isOSE || hasIntegrationKey;
}
