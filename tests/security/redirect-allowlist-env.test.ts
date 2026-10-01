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
 *   anything else (unset, development, miscased) → no hosts: the callback answers 500
 *   (the session cookie is Secure only for exactly 'production', so an unknown
 *   env must never complete a login)
 *
 * Mirrors lib/cors.ts, which already gates the staging origin by WORKER_ENV.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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

  for (const url of [...PRODUCTION_HOSTS, ...WORKERS_DEV]) {
    it(`staging refuses ${url}`, () => {
      expect(validateRedirectTarget(url, 'staging')).toBeNull();
    });
  }
});

describe('OW-153 | an unknown environment allows no redirect at all', () => {
  for (const workerEnv of [undefined, '', 'development', 'Staging', 'Production', 'prod']) {
    it(`WORKER_ENV=${String(workerEnv)} refuses every host`, () => {
      for (const url of [...PRODUCTION_HOSTS, ...STAGING_HOSTS, ...WORKERS_DEV]) {
        expect(validateRedirectTarget(url, workerEnv), url).toBeNull();
      }
    });
  }
});

describe('OW-153 | the callback itself refuses a non-production APP_URL in production', () => {
  function env(appUrl: string, workerEnv = 'production'): Env {
    return {
      WKRP_KV: {} as KVNamespace,
      WKRP_DB: {} as D1Database,
      WORKER_ENV: workerEnv,
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

  it('a miscased WORKER_ENV (Production) → 500, never a login with a non-Secure cookie', async () => {
    const res = await handleAuthCallback(
      new Request('https://ourwkrp.com/auth/callback?error=access_denied'),
      env('https://ourwkrp.com', 'Production')
    );
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });

  it('APP_URL=https://ourwkrp.com still redirects (happy path unchanged)', async () => {
    const res = await handleAuthCallback(
      new Request('https://ourwkrp.com/auth/callback?error=access_denied'),
      env('https://ourwkrp.com')
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://ourwkrp.com/?error=spotify_denied');
  });
});

describe('OW-153 | wrangler.toml APP_URL passes its own environment\'s allowlist', () => {
  const toml = fs.readFileSync(path.join(__dirname, '../../wrangler.toml'), 'utf-8');

  /**
   * The quoted value of `key` inside one [vars] table (top-level = staging).
   * Plain line comparison, no regex built from the arguments.
   */
  function varIn(table: string, key: string): string | undefined {
    const lines = toml.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim() === `[${table}]`);
    if (start === -1) return undefined;
    for (const raw of lines.slice(start + 1)) {
      const line = raw.trim();
      if (line.startsWith('[')) return undefined;
      const eq = line.indexOf('=');
      if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
      const value = line.slice(eq + 1).trim();
      return value.startsWith('"') ? value.slice(1, value.indexOf('"', 1)) : undefined;
    }
    return undefined;
  }

  const cases = [
    { table: 'vars', workerEnv: 'staging' },
    { table: 'env.production.vars', workerEnv: 'production' },
  ];

  for (const { table, workerEnv } of cases) {
    it(`[${table}] WORKER_ENV, APP_URL and SPOTIFY_REDIRECT_URI agree with the ${workerEnv} allowlist`, () => {
      expect(varIn(table, 'WORKER_ENV')).toBe(workerEnv);
      const appUrl = varIn(table, 'APP_URL') ?? '';
      expect(validateRedirectTarget(appUrl, workerEnv), `APP_URL="${appUrl}"`).toBe(appUrl);
      expect(varIn(table, 'SPOTIFY_REDIRECT_URI')).toBe(`${appUrl}/auth/callback`);
      expect(varIn(table, 'SPOTIFY_CLIENT_ID')).toMatch(/^[0-9a-f]{32}$/);
    });
  }
});
