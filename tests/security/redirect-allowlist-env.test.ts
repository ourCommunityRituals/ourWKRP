/**
 * OW-153 — the auth callback's redirect allowlist is per environment.
 *
 * The callback redirects to APP_URL after login, and only to an allowed host.
 * Until OW-153 the allowlist was one flat set for every environment, so
 * production would redirect a fresh session to stg.ourwkrp.com or to either
 * *.mzdano.workers.dev host. Each extra host is another place a login can land.
 *
 *   production → ourwkrp.com, www.ourwkrp.com (https only)
 *   staging    → stg.ourwkrp.com, localhost, 127.0.0.1
 *   anything else (unset, development, miscased) → the production set (fail closed)
 *
 * Mirrors lib/cors.ts, which already gates the staging origin by WORKER_ENV.
 */
import { describe, it, expect } from 'vitest';
import { handleAuthCallback, validateRedirectTarget } from '../../src/handlers/auth-callback';
import type { Env } from '../../src/types';

const STAGING_HOSTS = ['https://stg.ourwkrp.com', 'http://localhost:8787', 'http://127.0.0.1:8787'];
const WORKERS_DEV = [
  'https://ourwkrp-staging.mzdano.workers.dev',
  'https://ourwkrp-production.mzdano.workers.dev',
];
const PRODUCTION_HOSTS = ['https://ourwkrp.com', 'https://www.ourwkrp.com'];

describe('OW-153 | production redirects only to production hosts', () => {
  for (const url of PRODUCTION_HOSTS) {
    it(`production accepts ${url}`, () => {
      expect(validateRedirectTarget(url, 'production')).toBe(url);
    });
  }

  for (const url of [...STAGING_HOSTS, ...WORKERS_DEV]) {
    it(`production refuses ${url}`, () => {
      expect(validateRedirectTarget(url, 'production')).toBeNull();
    });
  }

  it('production refuses plain http even for its own host', () => {
    expect(validateRedirectTarget('http://ourwkrp.com', 'production')).toBeNull();
  });
});

describe('OW-153 | staging redirects only to staging hosts', () => {
  for (const url of STAGING_HOSTS) {
    it(`staging accepts ${url}`, () => {
      expect(validateRedirectTarget(url, 'staging')).toBe(url);
    });
  }

  for (const url of WORKERS_DEV) {
    it(`staging refuses ${url}`, () => {
      expect(validateRedirectTarget(url, 'staging')).toBeNull();
    });
  }
});

describe('OW-153 | an unknown environment fails closed to the production set', () => {
  for (const workerEnv of [undefined, '', 'development', 'Staging', 'prod']) {
    it(`WORKER_ENV=${String(workerEnv)} refuses stg.ourwkrp.com and localhost`, () => {
      expect(validateRedirectTarget('https://stg.ourwkrp.com', workerEnv)).toBeNull();
      expect(validateRedirectTarget('http://localhost:8787', workerEnv)).toBeNull();
      expect(validateRedirectTarget('https://ourwkrp.com', workerEnv)).toBe('https://ourwkrp.com');
    });
  }
});

describe('OW-153 | the callback itself refuses a non-production APP_URL in production', () => {
  function env(appUrl: string): Env {
    return {
      WKRP_KV: {} as KVNamespace,
      WKRP_DB: {} as D1Database,
      WORKER_ENV: 'production',
      WORKER_VERSION: '0.1.0',
      SPOTIFY_CLIENT_ID: 'test',
      SPOTIFY_REDIRECT_URI: `${appUrl}/auth/callback`,
      APP_URL: appUrl,
    };
  }

  for (const appUrl of ['https://stg.ourwkrp.com', ...WORKERS_DEV]) {
    it(`APP_URL=${appUrl} → 500, never a redirect`, async () => {
      const res = await handleAuthCallback(
        new Request('https://ourwkrp.com/auth/callback?error=access_denied'),
        env(appUrl)
      );
      expect(res.status).toBe(500);
      expect(res.headers.get('location')).toBeNull();
    });
  }

  it('APP_URL=https://ourwkrp.com still redirects (happy path unchanged)', async () => {
    const res = await handleAuthCallback(
      new Request('https://ourwkrp.com/auth/callback?error=access_denied'),
      env('https://ourwkrp.com')
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://ourwkrp.com/?error=spotify_denied');
  });
});
