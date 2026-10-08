/**
 * Structured logging — verbose console.logs for network tab + debugging
 * All logs appear in Cloudflare dashboard + wrangler dev console
 *
 * PII / secret hygiene: log payloads are passed through redact() so personal
 * identifiers, credentials, and raw user-supplied query content never reach the
 * Cloudflare log pipeline. This is a compliance control (GDPR/CCPA data
 * minimization) and is required to honour the "untracked" identity rung —
 * search terms and display names must not be retained by default.
 */

/**
 * Keys whose values are redacted anywhere they appear in a log payload.
 * Covers credentials, personal identifiers, and free-text the user typed
 * (search/filter terms) plus raw SQL diagnostics.
 */
export const REDACT_KEYS = new Set([
  'access_token', 'refresh_token', 'code_verifier', 'session_key', 'password',
  'authorization', 'cookie', 'set-cookie',
  'display_name', 'displayname', 'email', 'realname',
  // A contributor's name and a linked account's username are personal
  // identifiers too. Ids (contributor, listener, DJ) stay: they are opaque.
  'name', 'username', 'lastfm_username',
  'binds', 'sql', 'q', 'query', 'search', 'searchterm',
]);

/**
 * Recursively replace the value of any REDACT_KEYS key with '[redacted]'.
 * Exported so durable sinks (e.g. the audit trail) share one redaction source
 * of truth with the log pipeline — anything safe to log is safe to persist.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export function log(type: string, data: Record<string, unknown>): void {
  const safe = redact(data) as Record<string, unknown>;
  console.log(JSON.stringify({
    type,
    service: 'ourwkrp',
    ...safe,
    timestamp: data.timestamp ?? new Date().toISOString(),
  }));
}

export function logError(type: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const safe = context ? (redact(context) as Record<string, unknown>) : undefined;
  console.error(JSON.stringify({
    type,
    service: 'ourwkrp',
    error: message,
    stack,
    ...safe,
    timestamp: new Date().toISOString(),
  }));
}
