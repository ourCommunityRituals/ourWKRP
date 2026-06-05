/**
 * Session lifetime enforcement.
 *
 * A raw KV TTL only caps total age; it cannot express idle timeout. This adds:
 *   - absolute timeout: a session is dead 30 days after creation, full stop
 *   - idle timeout: a session is dead after 7 days with no activity
 * On a valid read we "touch" lastSeenAt (throttled, to avoid a KV write per
 * request) and re-store with the *remaining* absolute TTL so KV expiry tracks
 * the hard cap rather than resetting to a rolling 30 days.
 */

import type { SessionData } from '../types';
import { getSession, storeSession, deleteSession } from './kv-storage';

export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days inactivity
const SESSION_TOUCH_MS = 60 * 60 * 1000; // only persist lastSeenAt hourly

export type SessionCheck =
  | { ok: true; session: SessionData }
  | { ok: false; reason: 'absent' | 'expired' };

/** Stamp lifetime anchors on a freshly minted session. */
export function newSessionData(
  base: Omit<SessionData, 'createdAt' | 'lastSeenAt'>,
  now: number = Date.now(),
): SessionData {
  return { ...base, createdAt: now, lastSeenAt: now };
}

/**
 * Validate a session token: KV hit + idle/absolute timeout. Expired sessions
 * are deleted. Backfills lifetime anchors for sessions written before they
 * existed (treats "now" as both anchors), then re-stamps on the next touch.
 */
export async function validateSession(
  kv: KVNamespace,
  token: string,
  now: number = Date.now(),
): Promise<SessionCheck> {
  const session = await getSession(kv, token);
  if (!session) return { ok: false, reason: 'absent' };

  const createdAt = session.createdAt ?? now;
  const lastSeenAt = session.lastSeenAt ?? now;

  if (now - createdAt > SESSION_ABSOLUTE_MS || now - lastSeenAt > SESSION_IDLE_MS) {
    await deleteSession(kv, token);
    return { ok: false, reason: 'expired' };
  }

  // Touch (throttled) so idle timeout slides forward with real activity. Keep
  // KV expiry aligned to the absolute cap: remaining = 30d - age.
  const wasBackfilled = session.createdAt === undefined || session.lastSeenAt === undefined;
  if (wasBackfilled || now - lastSeenAt > SESSION_TOUCH_MS) {
    const touched: SessionData = { ...session, createdAt, lastSeenAt: now };
    const remainingMs = SESSION_ABSOLUTE_MS - (now - createdAt);
    await storeSession(kv, token, touched, Math.ceil(remainingMs / 1000));
    return { ok: true, session: touched };
  }

  return { ok: true, session: { ...session, createdAt, lastSeenAt } };
}
