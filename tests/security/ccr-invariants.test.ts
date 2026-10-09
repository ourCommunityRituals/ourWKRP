/**
 * Security invariant tests — CCR Loop 1-3 findings
 *
 * These tests verify the security properties identified during CCR review.
 * Each test maps to a specific CCR finding number.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getSessionToken, buildSessionCookie, buildClearSessionCookie } from '../../src/lib/session-cookie';

const SRC = (f: string) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf-8');

// ============================================
// CCR Finding #1: Sync endpoint must require session authentication
// ============================================
describe('CCR #1 — Sync requires session auth', () => {
  const syncSource = SRC('handlers/sync.ts');

  it('imports getSession from kv-storage', () => {
    expect(syncSource).toContain("getSession");
  });

  it('imports getSessionToken from session-cookie', () => {
    expect(syncSource).toContain("getSessionToken");
  });

  it('checks session token exists before proceeding', () => {
    expect(syncSource).toContain('!sessionToken');
  });

  it('validates session against KV', () => {
    expect(syncSource).toContain('getSession(env.WKRP_KV, sessionToken)');
  });

  it('verifies caller userId matches session userId', () => {
    expect(syncSource).toContain('session.userId !== userId');
  });

  it('returns 401 when no session cookie present', () => {
    expect(syncSource).toContain("'Authentication required'");
  });

  it('returns 403 when userId does not match session', () => {
    expect(syncSource).toContain('403');
    expect(syncSource).toContain("'Not authorized to sync this account'");
  });
});

// ============================================
// CCR Finding #2: Contributor upsert by spotify_user_id
// ============================================
describe('CCR #2 — Contributor upsert on spotify_user_id', () => {
  const callbackSource = SRC('handlers/auth-callback.ts');

  it('does NOT use ON CONFLICT(id) with random UUID', () => {
    // The old pattern generated a UUID and conflicted on it — dead code
    expect(callbackSource).not.toContain('ON CONFLICT(id)');
  });

  it('checks for existing contributor by spotify_user_id', () => {
    expect(callbackSource).toContain('WHERE spotify_user_id = ?');
  });

  it('updates existing contributor instead of duplicating', () => {
    expect(callbackSource).toContain('UPDATE contributors SET');
    expect(callbackSource).toContain('WHERE id = ?');
  });

  it('reuses existing contributor ID for returning users', () => {
    expect(callbackSource).toContain('existing.id as string');
  });
});

// ============================================
// CCR Finding #3: UNIQUE constraint on spotify_user_id
// ============================================
describe('CCR #3 — UNIQUE index on spotify_user_id', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../../migrations/0002_unique_spotify_user.sql'),
    'utf-8',
  );

  it('creates unique index on contributors.spotify_user_id', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX');
    expect(migration).toContain('spotify_user_id');
  });
});

// ============================================
// CCR Finding #4: Batch D1 writes
// ============================================
describe('CCR #4 — Sync uses db.batch() for writes', () => {
  const syncSource = SRC('spotify/sync-engine.ts');

  it('calls env.WKRP_DB.batch() for track writes', () => {
    expect(syncSource).toContain('.batch(statements)');
  });

  it('calls env.WKRP_DB.batch() for audio feature writes', () => {
    expect(syncSource).toContain('.batch(statements)');
  });

  it('defines BATCH_SIZE for chunking', () => {
    expect(syncSource).toContain('BATCH_SIZE');
  });
});

// ============================================
// CCR Finding #5: Code verifier modulo bias
// ============================================
describe('CCR #5 — Code verifier uses rejection sampling', () => {
  const oauthSource = SRC('auth/spotify-oauth.ts');

  it('uses rejection sampling (maxUnbiased threshold)', () => {
    expect(oauthSource).toContain('maxUnbiased');
  });

  it('rejects bytes above the unbiased threshold', () => {
    expect(oauthSource).toContain('byte < maxUnbiased');
  });

  it('over-samples to reduce rejection loops', () => {
    expect(oauthSource).toContain('length * 2');
  });
});

// ============================================
// CCR Finding #6: Session in HttpOnly cookie, not URL
// ============================================
describe('CCR #6 — Session token in HttpOnly cookie', () => {
  const callbackSource = SRC('handlers/auth-callback.ts');
  const connectHtml = fs.readFileSync(
    path.join(__dirname, '../../src/templates/connect.html'),
    'utf-8',
  );
  const catalogHtml = fs.readFileSync(
    path.join(__dirname, '../../src/templates/catalog.html'),
    'utf-8',
  );

  it('auth-callback sets Set-Cookie header instead of URL redirect', () => {
    expect(callbackSource).toContain("'Set-Cookie'");
    expect(callbackSource).toContain('buildSessionCookie');
  });

  it('auth-callback redirects to clean URL (no session in query string)', () => {
    // Should redirect to /catalog, not /?session=xxx
    expect(callbackSource).toContain('/catalog');
    expect(callbackSource).not.toMatch(/\?session=\$\{/);
  });

  it('connect.html does not read session from URL params', () => {
    expect(connectHtml).not.toContain("params.get('session')");
  });

  it('catalog.html does not read session from URL params or localStorage', () => {
    expect(catalogHtml).not.toContain("params.get('session')");
    expect(catalogHtml).not.toContain("localStorage.getItem('wkrp_session')");
    expect(catalogHtml).not.toContain("localStorage.setItem('wkrp_session'");
  });

  it('catalog.html uses cookie-based session via /auth/session/me', () => {
    expect(catalogHtml).toContain('/auth/session/me');
    expect(catalogHtml).toContain("credentials: 'same-origin'");
  });

  describe('session-cookie helper', () => {
    it('parses session token from Cookie header', () => {
      const request = new Request('http://localhost/', {
        headers: { Cookie: 'wkrp_session=abc123; other=xyz' },
      });
      expect(getSessionToken(request)).toBe('abc123');
    });

    it('returns null for missing cookie', () => {
      const request = new Request('http://localhost/');
      expect(getSessionToken(request)).toBeNull();
    });

    it('builds HttpOnly SameSite=Lax cookie', () => {
      const cookie = buildSessionCookie('token123', false);
      expect(cookie).toContain('wkrp_session=token123');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
    });

    it('adds Secure flag in production', () => {
      const cookie = buildSessionCookie('token123', true);
      expect(cookie).toContain('Secure');
    });

    it('does NOT add Secure flag in dev', () => {
      const cookie = buildSessionCookie('token123', false);
      expect(cookie).not.toContain('Secure');
    });

    it('clear cookie sets Max-Age=0', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toContain('Max-Age=0');
    });
  });
});

// ============================================
// CCR Finding #7: Sync rate limiting
// ============================================
describe('CCR #7 — Sync rate limit', () => {
  const syncSource = SRC('handlers/sync.ts');

  it('defines a cooldown period', () => {
    expect(syncSource).toContain('SYNC_COOLDOWN_MS');
  });

  it('checks last sync timestamp from KV', () => {
    expect(syncSource).toContain('getLastSync');
  });

  it('returns 429 when rate limited', () => {
    expect(syncSource).toContain('429');
    expect(syncSource).toContain('Retry-After');
  });

  it('calculates remaining cooldown time', () => {
    expect(syncSource).toContain('SYNC_COOLDOWN_MS - elapsed');
  });
});

// ============================================
// CCR Finding #8: Cache-Control no-store
// ============================================
describe('CCR #8 — Cache-Control no-store on HTML pages', () => {
  const pagesSource = SRC('handlers/pages.ts');

  it('sets no-store in Cache-Control', () => {
    expect(pagesSource).toContain('no-store');
  });

  it('sets must-revalidate', () => {
    expect(pagesSource).toContain('must-revalidate');
  });

  it('sets Pragma: no-cache for HTTP/1.0 compat', () => {
    expect(pagesSource).toContain('Pragma');
    expect(pagesSource).toContain('no-cache');
  });
});

// ============================================
// CCR Finding #9: Cross-product music seam floors listener-derived counts (T-SEAM / OSE-1295)
//   The sanctioned HTTP seam GET /api/events/:id/music is a cross-product export.
//   DJs stay named (the named pole); every listener-derived count takes the same
//   uniform floor OSE applies (count-floor.ts — OSE-665/683/711), so the seam
//   cannot disclose a small cohort OSE's own surfaces suppress.
// ============================================
describe('CCR #9 — Music export applies the uniform count floor (T-SEAM)', () => {
  const eventsSource = SRC('handlers/events.ts');

  it('imports the count-floor helpers', () => {
    expect(eventsSource).toContain("from '../lib/count-floor'");
    expect(eventsSource).toContain('applyCountFloor');
    expect(eventsSource).toContain('dropSubFloorRows');
  });

  it('floors distinct_listeners as one count, and builds total_attributions from floored tracks (OW-160)', () => {
    expect(eventsSource).toMatch(/applyCountFloor\(Number\(stats\.distinct_listeners/);
    // Drop before sum: the total is the sum of per-track counts that each clear
    // the floor, never the raw COUNT(*) floored as one number.
    expect(eventsSource).toMatch(/applyCountFloor\(\s*sumContributingBuckets\(/);
    expect(eventsSource).not.toMatch(/stats\.total_attributions/);
  });

  it('names counts honestly (#27) — no banned "unique_listeners" token on the seam', () => {
    expect(/\bunique_listeners\b/.test(eventsSource)).toBe(false);
    expect(eventsSource).toContain('distinct_listeners');
  });

  it('drops sub-floor top-track buckets and reports the suppressed count', () => {
    expect(eventsSource).toContain('dropSubFloorRows(');
    expect(eventsSource).toContain('top_tracks_below_floor');
  });

  it('does not publish raw aggregate_only — labels floored aggregates with named DJs', () => {
    expect(eventsSource).not.toContain("privacy: 'aggregate_only'");
    expect(eventsSource).toContain("privacy: 'floored_aggregate_listeners_named_djs'");
  });

  it('keeps DJs named (named pole preserved — names still selected and returned)', () => {
    expect(eventsSource).toContain('c.name as dj_name');
    expect(eventsSource).toContain('c.name as attributed_dj');
    // Sets are coarsened before egress (OSE-1299), not spread raw.
    expect(eventsSource).toContain('coarsenSets(');
    expect(eventsSource).toContain('sets,');
  });
});

// ============================================
// CCR Finding #10 (OSE-1299): cross-product seams are authenticated + coarsened
//   The music + sponsor seams export to OSE. Presence is not authorization:
//   both gate on a constant-time service-token compare (fail closed), and the
//   music seam coarsens per-set track_count/timestamps (differencing vector).
// ============================================
describe('CCR #10 — cross-product seams authenticate + coarsen (OSE-1299)', () => {
  const eventsSource = SRC('handlers/events.ts');
  const sponsorSource = SRC('handlers/sponsor.ts');
  const authSource = SRC('lib/cross-product-auth.ts');
  const privacySource = SRC('lib/privacy.ts');

  it('both seams gate on the cross-product token before any DB read', () => {
    for (const src of [eventsSource, sponsorSource]) {
      expect(src).toContain("from '../lib/cross-product-auth'");
      expect(src).toContain('requireCrossProductToken(request, env)');
      // The gate is called before the batch/DB read.
      const gateIdx = src.indexOf('requireCrossProductToken');
      const dbIdx = src.indexOf('WKRP_DB');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(dbIdx);
    }
  });

  it('the gate compares constant-time and fails closed on an unset secret', () => {
    expect(authSource).toContain('constantTimeEqual');
    expect(authSource).toContain('OSE_INTEGRATION_TOKEN');
    // Fail closed: unset expected secret returns false before comparing.
    expect(authSource).toMatch(/if \(!expected\) return false/);
    expect(authSource).toContain("code: 'UNAUTHORIZED'");
  });

  it('the music seam coarsens sets — drops track_count, dates timestamps', () => {
    expect(privacySource).toContain('export function coarsenSets');
    expect(privacySource).toContain('delete out.track_count');
    expect(eventsSource).toContain('coarsenSets(');
  });
});
