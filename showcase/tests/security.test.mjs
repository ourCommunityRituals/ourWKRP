// Layer 0, security. Runs first in CI; a red here stops every later layer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as C from './checks.mjs';
import { realModules } from './modules.mjs';

let m;
beforeAll(async () => {
  m = await realModules();
});

describe('creator showcase: security', () => {
  it('escapes every creator and report field (script, attribute breakout, javascript: URLs)', () => {
    expect(C.escapingProblems(m)).toEqual([]);
  });
  it('links only https: sources', () => {
    expect(C.linkProblems(m)).toEqual([]);
  });
  it('shows only local img/ report images', () => {
    expect(C.imagePathProblems(m)).toEqual([]);
  });
  it('publishes no signed report link, key or token', () => {
    expect(C.secretProblems(m)).toEqual([]);
  });
  it('refuses to publish a page carrying a secret or an identity', () => {
    expect(C.publishGateProblems(m)).toEqual([]);
  });
  it('never who: the page names no person, cookie or id', () => {
    expect(C.neverWhoProblems(m)).toEqual([]);
  });
  it('floor: a count under 5 reads "Fewer than 5"', () => {
    expect(C.floorProblems(m)).toEqual([]);
  });
  it('seeds and captures only from this machine', () => {
    expect(C.localOnlyProblems(m)).toEqual([]);
  });
  it('carries no inline event handlers (served-page CSP)', () => {
    expect(C.cspProblems(m)).toEqual([]);
  });
  it('keeps the signed-link work file and the local key out of git', () => {
    const ignore = readFileSync(join(C.SHOWCASE, '..', '.gitignore'), 'utf8');
    for (const line of ['showcase/work/', 'showcase/out/', 'showcase/local-ose.env.json', 'showcase/creators/*.json']) {
      expect(ignore.split(/\r?\n/), line).toContain(line);
    }
  });
});
