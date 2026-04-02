/**
 * Structured logging — verbose console.logs for network tab + debugging
 * All logs appear in Cloudflare dashboard + wrangler dev console
 */

export function log(type: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({
    type,
    service: 'ourwkrp',
    ...data,
    timestamp: data.timestamp ?? new Date().toISOString(),
  }));
}

export function logError(type: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(JSON.stringify({
    type,
    service: 'ourwkrp',
    error: message,
    stack,
    ...context,
    timestamp: new Date().toISOString(),
  }));
}
