/**
 * PROPAGATED-FILE INTEGRITY — OW-141 (implements OCR_STANDARD_ciConventions §7).
 *
 * Some files are propagated BYTE-IDENTICAL from OSE (the base repo) so the two
 * copies stay diffable. Their headers say "fix it upstream and re-propagate
 * rather than editing this copy in place" — but a prose instruction is not a
 * gate. This test is the gate: it pins the sha256 of each propagated file, so an
 * accidental in-place edit (the documented failure mode) fails CI instead of
 * silently diverging from the OSE original.
 *
 * When OSE legitimately changes an upstream file and re-propagates it, the
 * propagation commit updates BOTH the file and its pinned hash here together —
 * so an *intended* change is a one-line hash bump, while an *accidental* local
 * edit is a red test that points you back upstream.
 *
 * SCOPE (honest boundary): this catches drift of the local copy. It does NOT
 * detect the inverse — OSE changing upstream while WKRP is not re-propagated —
 * which needs cross-repo access WKRP CI does not have today (OW-141 notes the
 * richer cross-repo checksum as a follow-on).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../..');

/**
 * The propagated-file registry. Each entry pins the exact bytes of a file
 * propagated from another repo. To add one: propagate the file, then paste its
 * `sha256sum` output here. To update one after an upstream re-propagation: bump
 * `sha256` in the same commit that updates the file.
 *
 * CRLF TRAP (OW-141): compute the hash on an LF checkout. Each pinned file is
 * held at `eol=lf` in `.gitattributes`, so the blob CI reads and the working
 * copy a Windows author hashes are the same bytes. Running `sha256sum` on a
 * CRLF working copy yields a DIFFERENT digest than the LF blob and will
 * false-red this gate — that is what happened when this pin was first written.
 */
const PROPAGATED_FILES: Array<{ path: string; sha256: string; source: string }> = [
  {
    path: 'scripts/pw-guarded.sh',
    // LF digest of the propagated file (matches the git blob; pinned eol=lf).
    sha256: '98619e0c32832427e9ed95a40873daebf330a460f82507e91d595d55d703311d',
    source: 'OSE (ourSharedEvents PR #423 / OSE-852) — fail-closed Playwright runner',
  },
];

function sha256Of(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

describe('propagated-file integrity | byte-identical copies must not drift in place', () => {
  // Non-vacuity: an empty registry would make every assertion below trivially
  // pass, reporting green while guarding nothing. Fail loudly if it is emptied.
  it('the registry is non-empty', () => {
    expect(PROPAGATED_FILES.length).toBeGreaterThan(0);
  });

  for (const file of PROPAGATED_FILES) {
    it(`${file.path} matches its pinned hash`, () => {
      const abs = join(REPO_ROOT, file.path);

      // Non-vacuity: a missing or empty file must not pass. (A deleted file would
      // otherwise never reach the hash comparison.)
      expect(existsSync(abs), `${file.path} is missing`).toBe(true);
      const bytes = readFileSync(abs);
      expect(bytes.length, `${file.path} is empty`).toBeGreaterThan(0);

      const actual = sha256Of(abs);
      expect(
        actual,
        `\n${file.path} has diverged from its propagated original.\n` +
          `Source: ${file.source}.\n` +
          `This file is propagated BYTE-IDENTICAL — do not edit it in place.\n` +
          `  • If this change was accidental: revert it (re-propagate from the source).\n` +
          `  • If the source legitimately changed: re-propagate, then bump the pinned\n` +
          `    sha256 in this test in the SAME commit.\n` +
          `Expected ${file.sha256}\nActual   ${actual}\n`,
      ).toBe(file.sha256);
    });
  }
});
