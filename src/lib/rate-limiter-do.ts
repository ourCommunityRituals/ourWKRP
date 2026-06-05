/**
 * RateLimiterDO — atomic fixed-window rate limiter backed by a Durable Object.
 *
 * Why a DO: KV has no atomic increment and is eventually consistent, so the
 * KV limiter (see rate-limit.ts) can undercount under concurrent requests —
 * a parallel burst can slip past the cap. A Durable Object serializes all
 * requests to a single instance, so read-increment-write is atomic without
 * locks. We key one instance per (bucket + client identity), which bounds each
 * caller independently and keeps any single object's traffic tiny.
 *
 * The window math mirrors the KV limiter exactly; only the increment is now
 * guaranteed. State is persisted to DO storage so it survives hibernation.
 */

interface WindowState {
  c: number;     // count so far in the current window
  reset: number; // epoch ms when the window ends
}

interface ConsumeRequest {
  limit: number;
  windowMs: number;
}

export interface ConsumeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

const STORAGE_KEY = 'window';

export class RateLimiterDO {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { limit, windowMs } = (await request.json()) as ConsumeRequest;
    const now = Date.now();

    let state = await this.storage.get<WindowState>(STORAGE_KEY);

    // Start a fresh window if none exists or the prior one has elapsed.
    if (!state || now >= state.reset) {
      state = { c: 0, reset: now + windowMs };
    }

    if (state.c >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((state.reset - now) / 1000));
      // Persist so the reset time is stable across hibernation even when blocked.
      await this.storage.put(STORAGE_KEY, state);
      return Response.json({ allowed: false, limit, remaining: 0, retryAfterSec } satisfies ConsumeResult);
    }

    state.c += 1;
    await this.storage.put(STORAGE_KEY, state);
    // Bound storage growth: drop the key once the window is guaranteed expired.
    await this.storage.setAlarm(state.reset);

    return Response.json({
      allowed: true,
      limit,
      remaining: limit - state.c,
      retryAfterSec: 0,
    } satisfies ConsumeResult);
  }

  /** Fired at window end — clear state so an idle identity leaves no residue. */
  async alarm(): Promise<void> {
    const state = await this.storage.get<WindowState>(STORAGE_KEY);
    if (state && Date.now() >= state.reset) {
      await this.storage.delete(STORAGE_KEY);
    }
  }
}
