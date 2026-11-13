/**
 * OW-203 — the contract runs against a deployed Worker, and its subset stays stateless.
 *
 * `npm run test:bruno` points the Core Flows collection at `wrangler dev`. That
 * mocks the boundary: the collection stays green whether or not the deployed
 * routes answer the same shape, which is the same class of gap the
 * security-control-wiring invariant calls out for controls. `contract:staging`
 * closes it for the public reads by running the stateless subset against
 * stg.ourwkrp.com after the staging deploy.
 *
 * Two things rot if nobody watches them:
 *
 *   1. The step gets dropped from the staging job, and the only thing left
 *      proving the deployed contract is smoke.mjs.
 *   2. A request in the subset quietly grows a state dependency — a
 *      {{contributor_id}}, a {{session_cookie}} — and then the staging run
 *      starts failing for reasons that have nothing to do with the contract,
 *      and someone "fixes" it by deleting the step.
 *
 * The second is the likelier one and the reason the subset is asserted here
 * rather than only in the script.
 *
 * Born red: each detector is exercised against synthetic inputs that violate
 * the rule before it touches the real files.
 *
 * Brain: per-repo gate. Candidate for central registration with
 * security_control_wiring and deploy_gating; number assigned centrally,
 * NOT minted here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..', '..');
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const SCRIPT = readFileSync(join(ROOT, 'scripts/contract-staging.mjs'), 'utf-8');

const COLLECTION = join(ROOT, 'bruno', 'wkrp-api', '1. Core Flows');

/** Placeholders that mean a request depends on state another request created. */
const STATE_VARS = [
  'contributor_id',
  'playlist_id',
  'session_cookie',
  'track_id',
  'track_ids',
  'set_id',
  'dj_id',
  'user_id',
  'oauth_code',
  'oauth_state',
  'lastfm_token',
];

/** The subset the script declares, read from the script itself. */
function declaredRequests(source: string): string[] {
  const block = source.match(/const REQUESTS = \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+\.yml)'/g)].map((m) => m[1]);
}

function dependsOnState(yml: string): string[] {
  return STATE_VARS.filter((v) => yml.includes(`{{${v}}}`));
}

function requiresAuth(yml: string): boolean {
  return /WKRP_ADMIN_TOKEN|Authorization:|admin_token/i.test(yml);
}

const REQUESTS = declaredRequests(SCRIPT);

describe('OW-203 — deployed-staging contract', () => {
  describe('the detectors are born red', () => {
    it('flags a request carrying a state placeholder', () => {
      expect(dependsOnState('url: "{{baseUrl}}/api/playlists/{{playlist_id}}"')).toContain(
        'playlist_id',
      );
    });

    it('passes a request that only uses baseUrl', () => {
      expect(dependsOnState('url: "{{baseUrl}}/health"')).toEqual([]);
    });

    it('flags a request that needs an admin token', () => {
      expect(requiresAuth('headers:\n  Authorization: Bearer {{admin}}')).toBe(true);
    });

    it('finds nothing in a script with no REQUESTS block', () => {
      expect(declaredRequests('const OTHER = [];')).toEqual([]);
    });
  });

  describe('wiring', () => {
    it('the npm script exists', () => {
      expect(PKG.scripts['contract:staging']).toBe('node scripts/contract-staging.mjs');
    });

    it('the staging job runs it', () => {
      const jobs = (parse(CI) as { jobs: Record<string, { steps?: { run?: string }[] }> }).jobs;
      const runs = (jobs['deploy-staging'].steps ?? []).map((s) => s.run ?? '').join('\n');
      expect(runs).toContain('npm run contract:staging');
    });

    it('it runs after the smoke, so a dead Worker fails on the cheaper check first', () => {
      const jobs = (parse(CI) as { jobs: Record<string, { steps?: { run?: string }[] }> }).jobs;
      const runs = (jobs['deploy-staging'].steps ?? []).map((s) => s.run ?? '');
      const smoke = runs.findIndex((r) => r.includes('smoke:staging'));
      const contract = runs.findIndex((r) => r.includes('contract:staging'));
      expect(smoke).toBeGreaterThanOrEqual(0);
      expect(contract).toBeGreaterThan(smoke);
    });
  });

  describe('the declared subset', () => {
    it('is not empty', () => {
      expect(REQUESTS.length).toBeGreaterThan(0);
    });

    it('every declared request exists in the collection', () => {
      for (const r of REQUESTS) {
        expect(existsSync(join(COLLECTION, r)), `missing: ${r}`).toBe(true);
      }
    });

    it('no declared request depends on state another request creates', () => {
      for (const r of REQUESTS) {
        const yml = readFileSync(join(COLLECTION, r), 'utf-8');
        expect(dependsOnState(yml), `${r} grew a state dependency`).toEqual([]);
      }
    });

    it('no declared request needs an admin token', () => {
      for (const r of REQUESTS) {
        const yml = readFileSync(join(COLLECTION, r), 'utf-8');
        expect(requiresAuth(yml), `${r} needs auth`).toBe(false);
      }
    });

    it('every declared request is a GET, so staging accumulates nothing', () => {
      for (const r of REQUESTS) {
        const yml = readFileSync(join(COLLECTION, r), 'utf-8');
        const method = yml.match(/method:\s*(\w+)/)?.[1];
        expect(method, `${r} is ${method}`).toBe('GET');
      }
    });

    it('every declared request carries its own assertions', () => {
      for (const r of REQUESTS) {
        const yml = readFileSync(join(COLLECTION, r), 'utf-8');
        expect(yml, `${r} asserts nothing`).toMatch(/test\(/);
      }
    });
  });
});
