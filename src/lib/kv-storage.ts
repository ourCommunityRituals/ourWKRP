/**
 * KV storage helpers for wkrp:* keys
 * Handles auth state, sessions, and tokens
 */

import type { AuthState, SessionData, StoredTokens } from '../types';
import { log } from './logger';

// Auth state (PKCE verifier + contributor info) — 10 min TTL
export async function storeAuthState(kv: KVNamespace, state: string, data: AuthState): Promise<void> {
  const key = `wkrp:auth:${state}`;
  await kv.put(key, JSON.stringify(data), { expirationTtl: 600 });
  log('KV_WRITE', { key, ttl: 600 });
}

export async function getAuthState(kv: KVNamespace, state: string): Promise<AuthState | null> {
  const key = `wkrp:auth:${state}`;
  const raw = await kv.get(key);
  if (!raw) {
    log('KV_MISS', { key });
    return null;
  }
  log('KV_HIT', { key });
  return JSON.parse(raw) as AuthState;
}

export async function deleteAuthState(kv: KVNamespace, state: string): Promise<void> {
  await kv.delete(`wkrp:auth:${state}`);
}

// Session (maps session token -> contributor). Default 30 day TTL; callers may
// pass a shorter remaining TTL so KV expiry tracks the absolute-lifetime cap.
export const SESSION_TTL_SEC = 2592000; // 30 days

export async function storeSession(
  kv: KVNamespace,
  token: string,
  data: SessionData,
  ttlSec: number = SESSION_TTL_SEC,
): Promise<void> {
  const key = `wkrp:session:${token}`;
  // KV rejects TTLs below 60s; floor to keep near-expiry writes valid.
  const ttl = Math.max(60, Math.floor(ttlSec));
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  log('KV_WRITE', { key, ttl });
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  const key = `wkrp:session:${token}`;
  const raw = await kv.get(key);
  if (!raw) {
    log('KV_MISS', { key });
    return null;
  }
  log('KV_HIT', { key });
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  const key = `wkrp:session:${token}`;
  await kv.delete(key);
  log('KV_DELETE', { key });
}

// Spotify tokens — no TTL (refresh handled in code)
export async function storeTokens(kv: KVNamespace, userId: string, tokens: StoredTokens): Promise<void> {
  const key = `wkrp:tokens:${userId}`;
  await kv.put(key, JSON.stringify(tokens));
  log('KV_WRITE', { key, expires_at: new Date(tokens.expires_at).toISOString() });
}

export async function getTokens(kv: KVNamespace, userId: string): Promise<StoredTokens | null> {
  const key = `wkrp:tokens:${userId}`;
  const raw = await kv.get(key);
  if (!raw) {
    log('KV_MISS', { key });
    return null;
  }
  log('KV_HIT', { key });
  return JSON.parse(raw) as StoredTokens;
}

// Last.fm session keys — permanent (no expiry)
export async function storeLastfmSession(kv: KVNamespace, contributorId: string, data: { username: string; session_key: string }): Promise<void> {
  const key = `wkrp:lastfm:${contributorId}`;
  await kv.put(key, JSON.stringify(data));
  log('KV_WRITE', { key });
}

export async function getLastfmSession(kv: KVNamespace, contributorId: string): Promise<{ username: string; session_key: string } | null> {
  const key = `wkrp:lastfm:${contributorId}`;
  const raw = await kv.get(key);
  if (!raw) {
    log('KV_MISS', { key });
    return null;
  }
  log('KV_HIT', { key });
  return JSON.parse(raw) as { username: string; session_key: string };
}

// Last sync timestamp
export async function storeLastSync(kv: KVNamespace, userId: string): Promise<void> {
  const key = `wkrp:last_sync:${userId}`;
  const now = new Date().toISOString();
  await kv.put(key, now);
  log('KV_WRITE', { key, value: now });
}

export async function getLastSync(kv: KVNamespace, userId: string): Promise<string | null> {
  return await kv.get(`wkrp:last_sync:${userId}`);
}
