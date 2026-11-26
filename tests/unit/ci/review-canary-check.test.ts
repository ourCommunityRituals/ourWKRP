/**
 * The review canary's judge (AI Problems Index assessment, 2026-11-26, Step 2).
 * Born red: every way the reviewer can fail is a case that must fail, next to
 * the one answer that passes. The fixture line range is checked against the
 * real fixture, so moving the flaw without moving the range goes red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error -- plain .mjs script, no types
import { judge, PLANTED_LINES } from '../../../scripts/ci/review-canary-check.mjs';

const result = (text: string) => [{ type: 'system' }, { type: 'result', result: text }];

describe('review canary judge', () => {
  it('passes when the planted line is named and the clean file is not', () => {
    expect(judge(result('SQL injection.\nCANARY: tests/fixtures/review-canary/planted.ts.txt:10')).pass).toBe(true);
  });
  it('accepts the answer from the last assistant message when no result message exists', () => {
    const msgs = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'CANARY: planted.ts.txt:9' }] } }];
    expect(judge(msgs).pass).toBe(true);
  });
  it('fails when the reviewer did not run (no file, empty array, empty answer)', () => {
    expect(judge(null).pass).toBe(false);
    expect(judge([]).pass).toBe(false);
    expect(judge(result('')).pass).toBe(false);
  });
  it('fails on CANARY: NONE', () => {
    expect(judge(result('Looks fine.\nCANARY: NONE')).pass).toBe(false);
  });
  it('fails when the answer has no CANARY line', () => {
    expect(judge(result('planted.ts.txt line 10 has SQL injection')).pass).toBe(false);
  });
  it('fails when it names the wrong line of the planted file', () => {
    expect(judge(result('CANARY: planted.ts.txt:5')).pass).toBe(false);
  });
  it('fails when it also flags the clean file (a false alarm)', () => {
    expect(judge(result('CANARY: planted.ts.txt:10\nCANARY: clean.ts.txt:9')).pass).toBe(false);
  });
  it('the expected range covers the planted query in the real fixture', () => {
    const file = path.resolve(__dirname, '../../fixtures/review-canary/planted.ts.txt');
    const lines = readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes("slug = '${slug}'")) + 1;
    expect(at).toBeGreaterThanOrEqual(PLANTED_LINES[0]);
    expect(at).toBeLessThanOrEqual(PLANTED_LINES[1]);
  });
});
