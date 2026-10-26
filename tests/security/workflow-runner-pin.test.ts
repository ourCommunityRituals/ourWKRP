/**
 * CI workflow hygiene — every job runs on a pinned runner image, never a floating alias.
 *
 * `ubuntu-latest` is an alias GitHub moves to a new Ubuntu without any commit here. It moved to 26.04
 * in 2026-10, and Playwright could not install Chromium on it ("Playwright does not support chromium
 * on ubuntu26.04-x64"), so the Mobile Workability audit and anything else using a browser went red
 * with no change on our side. ourSharedEvents already pinned `ubuntu-24.04` and was unaffected.
 *
 * A pinned image changes only when someone changes it, in one reviewed edit, after checking that the
 * browsers, Doppler CLI and Bruno still install on it.
 *
 * String-based, like workflow-timeout-hygiene.test.ts: this repo has no YAML dependency.
 * Fail-closed: anything that is not a plain `ubuntu-NN.NN` label is a violation, including an
 * expression (a matrix or input could float), `self-hosted`, and any `-latest` alias.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PINNED = /^ubuntu-\d{2}\.\d{2}$/;

/** Every `runs-on:` value in a workflow's source, comments and trailing comments removed. */
export function runnerLabels(src: string): string[] {
  const labels: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*runs-on:\s*(.*)$/.exec(line);
    if (!m) continue;
    labels.push(m[1].replace(/\s+#.*$/, '').trim());
  }
  return labels;
}

/** The labels that are not a pinned image. */
export function unpinned(src: string): string[] {
  return runnerLabels(src).filter((label) => !PINNED.test(label));
}

describe('the rule: a pinned image passes, anything else is a violation', () => {
  it('a numbered Ubuntu image is pinned', () => {
    expect(unpinned('jobs:\n  a:\n    runs-on: ubuntu-24.04\n')).toEqual([]);
    expect(unpinned('    runs-on: ubuntu-22.04')).toEqual([]);
  });
  it('the floating alias is a violation', () => {
    expect(unpinned('    runs-on: ubuntu-latest')).toEqual(['ubuntu-latest']);
  });
  it('an expression, a list and self-hosted fail closed', () => {
    expect(unpinned('    runs-on: ${{ matrix.os }}')).toEqual(['${{ matrix.os }}']);
    expect(unpinned('    runs-on: ${{ inputs.runner }}')).toEqual(['${{ inputs.runner }}']);
    expect(unpinned('    runs-on: [self-hosted, linux]')).toEqual(['[self-hosted, linux]']);
    expect(unpinned('    runs-on: self-hosted')).toEqual(['self-hosted']);
  });
  it('other vendors and other floating aliases are violations', () => {
    expect(unpinned('    runs-on: windows-latest')).toEqual(['windows-latest']);
    expect(unpinned('    runs-on: macos-latest')).toEqual(['macos-latest']);
    expect(unpinned('    runs-on: ubuntu-24.04-arm')).toEqual(['ubuntu-24.04-arm']);
  });
  it('a trailing comment is ignored; a commented-out line is not a runs-on', () => {
    expect(unpinned('    runs-on: ubuntu-24.04 # pinned on purpose')).toEqual([]);
    expect(unpinned('    # runs-on: ubuntu-latest')).toEqual([]);
  });
  it('windows line endings do not hide a violation', () => {
    expect(unpinned('a:\r\n    runs-on: ubuntu-latest\r\n')).toEqual(['ubuntu-latest']);
    expect(unpinned('a:\r\n    runs-on: ubuntu-24.04\r\n')).toEqual([]);
  });
  it('reports every label, in order', () => {
    expect(runnerLabels('    runs-on: ubuntu-24.04\n    runs-on: ubuntu-latest\n    runs-on: self-hosted\n')).toEqual([
      'ubuntu-24.04',
      'ubuntu-latest',
      'self-hosted',
    ]);
  });
});

describe('the real workflows', () => {
  const dir = path.join(__dirname, '../../.github/workflows');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  it('discovers workflow files and jobs (a green run is not an empty run)', () => {
    expect(files.length).toBeGreaterThan(3);
    const jobs = files.reduce((n, f) => n + runnerLabels(fs.readFileSync(path.join(dir, f), 'utf-8')).length, 0);
    expect(jobs).toBeGreaterThanOrEqual(15);
  });

  for (const file of files) {
    it(`${file}: every job runs on a pinned image`, () => {
      const bad = unpinned(fs.readFileSync(path.join(dir, file), 'utf-8'));
      expect(
        bad,
        `floating or unrecognised runner label(s): ${JSON.stringify(bad)}. Pin a numbered image such as ubuntu-24.04.`,
      ).toEqual([]);
    });
  }
});
