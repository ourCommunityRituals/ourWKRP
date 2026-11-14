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
  it('escapes every creator, report and OSE field on every page (script, attribute breakout, javascript: URLs)', async () => {
    expect(await C.escapingProblems(m)).toEqual([]);
  });
  it('links only https: sources and places', () => {
    expect(C.linkProblems(m)).toEqual([]);
  });
  it('links each place exactly as the creator file gives it, never through a counting path', async () => {
    expect(await C.placeLinkProblems(m)).toEqual([]);
  });
  it('shows only local img/ report images', () => {
    expect(C.imagePathProblems(m)).toEqual([]);
  });
  it('publishes no signed report link, key or token', async () => {
    expect(await C.secretProblems(m)).toEqual([]);
  });
  it('refuses to publish a page carrying a secret or an identity', async () => {
    expect(await C.publishGateProblems(m)).toEqual([]);
  });
  it('never who: no page names a person, cookie or id', async () => {
    expect(await C.neverWhoProblems(m)).toEqual([]);
  });
  it('floor: a count under 5 reads "Fewer than 5"', async () => {
    expect(await C.floorProblems(m)).toEqual([]);
  });
  it('seeds and captures only from this machine', () => {
    expect(C.localOnlyProblems(m)).toEqual([]);
  });
  it('reads a local OSE or OSE staging only, never production', () => {
    expect(C.readBaseProblems(m)).toEqual([]);
  });
  it("reads OSE through its public API only: GET, no key, no cookie", async () => {
    expect(await C.readOnlyProblems(m)).toEqual([]);
  });
  it('the where map: nothing in OSE\'s answer reaches a page unchecked (script, handler, link, address, stylesheet breakout, another area)', async () => {
    expect(await C.mapAnswerProblems(m)).toEqual([]);
  });
  it('sponsors: only what OSE lists with both sides agreed, below the title and date, a name and nothing else, never a control, no beacon', async () => {
    expect(await C.sponsorProblems(m)).toEqual([]);
  });
  it('stops the build when OSE text names the creator, a venture or one of her links', async () => {
    expect(await C.neutralNameProblems(m)).toEqual([]);
  });
  it('checks the creator file before reading OSE: a bad file makes no read', async () => {
    expect(await C.fileFirstProblems(m)).toEqual([]);
  });
  it('stops the build when an upcoming event loses its codes (failed bundle, unknown placement)', async () => {
    expect(await C.lostCodeProblems(m)).toEqual([]);
  });
  it('drops a linked event that is missing, not public or on another brand', async () => {
    expect(await C.dropProblems(m)).toEqual([]);
  });
  it('turns only OSE /q and /s URLs on the read origin into codes', () => {
    expect(C.codeOriginProblems(m)).toEqual([]);
  });
  it('refuses to publish a page with any other code', async () => {
    expect(await C.codeGateProblems(m)).toEqual([]);
  });
  it('never shows a form (check-in, register) as a tracked code', async () => {
    expect(await C.formCodeProblems(m)).toEqual([]);
  });
  it("draws each QR from its link's own URL (decoded by jsQR)", async () => {
    expect(await C.qrMatchProblems(m)).toEqual([]);
  });
  it('refuses to publish a QR that encodes anything but its own link', () => {
    expect(C.qrGateProblems(m)).toEqual([]);
  });
  it('shows no code for a past event, nor on a frequency with nothing upcoming', async () => {
    expect(await C.pastCodeProblems(m)).toEqual([]);
  });
  it('carries no inline event handlers (served-page CSP)', async () => {
    expect(await C.cspProblems(m)).toEqual([]);
  });
  it('keeps the signed-link work file and the local key out of git', () => {
    const ignore = readFileSync(join(C.SHOWCASE, '..', '.gitignore'), 'utf8');
    for (const line of ['showcase/work/', 'showcase/out/', 'showcase/local-ose.env.json', 'showcase/creators/*.json']) {
      expect(ignore.split(/\r?\n/), line).toContain(line);
    }
  });
});
