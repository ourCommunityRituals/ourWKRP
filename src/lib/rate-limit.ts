/**
 * Fixed-window rate limiting.
 *
 * Purpose: blunt automated abuse and cost-amplification (e.g. scripted /import
 * floods that each drive hundreds of D1 writes, or session-token spraying).
 *
 * Two backends, chosen per bucket:
 *   - Hot buckets ('import', 'auth') use a Durable Object (RateLimiterDO) when
 *     the RATE_LIMITER binding is present. A DO serializes requests to one
 *     instance, so the increment is atomic — a parallel burst cannot slip past
 *     the cap. These are the abuse-prone, cost-amplifying surfaces.
 *   - The read-heavy 'api' bucket stays on KV: a small undercount under
 *     concurrency is acceptable there, and KV avoids per-request DO cost.
 *
 * KV is also the fallback for the hot buckets when RATE_LIMITER is unbound
 * (local dev / tests): still rate-limited, just best-effort rather than atomic.
 * The window/reset math is identical across both backends.
 */

import type { Env } from '../types';
import type { ConsumeResult } from './rate-limiter-do';
import { log } from './logger';

/** Buckets that get the atomic DO counter when the binding is available. */
const DURABLE_BUCKETS: ReadonlySet<RateBucket> = new Set<RateBucket>(['import', 'auth']);

export type RateBucket = 'import' | 'auth' | 'api';

interface BucketPolicy {
  limit: number;
  windowSec: number;
}

/** Per-bucket policy. Tighter on expensive/abuse-prone endpoints. */
const POLICIES: Record<RateBucket, BucketPolicy> = {
  import: { limit: 10, windowSec: 60 },   // each import can drive many D1 writes
  auth: { limit: 20, windowSec: 60 },     // OAuth start/callback + session lookups
  api: { limit: 120, windowSec: 60 },     // read-heavy catalog/JSON endpoints
};

interface WindowState {
  c: number;     // count so far in the current window
  reset: number; // epoch ms when the window ends
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/** Derive the caller identity for bucketing — Cloudflare-provided client IP. */
function clientId(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')
    ?? 'unknown';
}

/** Map a request to a rate-limit bucket, or null if the route is unthrottled. */
export function bucketFor(method: string, path: string): RateBucket | null {
  if (method === 'POST' && path.startsWith('/import/')) return 'import';
  if (path.startsWith('/auth/')) return 'auth';
  if (
    path.startsWith('/api/') ||
    path.startsWith('/lastfm/') ||
    path.startsWith('/spotify/')
  ) return 'api';
  return null;
}

async function consume(
  kv: KVNamespace,
  bucket: RateBucket,
  id: string,
): Promise<RateLimitResult> {
  const { limit, windowSec } = POLICIES[bucket];
  const windowMs = windowSec * 1000;
  const now = Date.now();
  const key = `wkrp:rl:${bucket}:${id}`;

  let state: WindowState | null = null;
  const raw = await kv.get(key);
  if (raw) {
    try {
      state = JSON.parse(raw) as WindowState;
    } catch {
      state = null;
    }
  }

  // Start a fresh window if none exists or the prior one has elapsed.
  if (!state || now >= state.reset) {
    state = { c: 0, reset: now + windowMs };
  }

  if (state.c >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((state.reset - now) / 1000));
    return { allowed: false, limit, remaining: 0, retryAfterSec };
  }

  state.c += 1;
  const ttlSec = Math.max(1, Math.ceil((state.reset - now) / 1000));
  await kv.put(key, JSON.stringify(state), { expirationTtl: ttlSec });

  return { allowed: true, limit, remaining: limit - state.c, retryAfterSec: 0 };
}

/** Atomic consume via the Durable Object — one instance per bucket+identity. */
async function consumeDurable(
  ns: DurableObjectNamespace,
  bucket: RateBucket,
  id: string,
): Promise<RateLimitResult> {
  const { limit, windowSec } = POLICIES[bucket];
  const stub = ns.get(ns.idFromName(`${bucket}:${id}`));
  const res = await stub.fetch('https://rate-limiter/consume', {
    method: 'POST',
    body: JSON.stringify({ limit, windowMs: windowSec * 1000 }),
  });
  const r = (await res.json()) as ConsumeResult;
  return { allowed: r.allowed, limit: r.limit, remaining: r.remaining, retryAfterSec: r.retryAfterSec };
}

/**
 * Enforce the rate limit for a request. Returns a 429 Response when the caller
 * is over budget, or null to allow the request through. Fails open on backend
 * errors (availability over strictness) — logged for monitoring.
 */
export async function enforceRateLimit(
  request: Request,
  env: Env,
  method: string,
  path: string,
): Promise<Response | null> {
  const bucket = bucketFor(method, path);
  if (!bucket) return null;

  const id = clientId(request);
  let result: RateLimitResult;
  try {
    if (DURABLE_BUCKETS.has(bucket) && env.RATE_LIMITER) {
      result = await consumeDurable(env.RATE_LIMITER, bucket, id);
    } else {
      result = await consume(env.WKRP_KV, bucket, id);
    }
  } catch (err) {
    log('RATE_LIMIT_ERROR', { bucket, error: err instanceof Error ? err.message : String(err) });
    return null; // fail open — don't take the site down if the backend hiccups
  }

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };

  if (result.allowed) return null;

  log('RATE_LIMITED', { bucket, path });
  return new Response(
    JSON.stringify({ ok: false, error: 'Too many requests', retry_after: result.retryAfterSec }),
    {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSec),
      },
    },
  );
}
