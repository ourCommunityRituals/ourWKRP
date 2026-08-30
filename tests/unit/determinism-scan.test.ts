/**
 * L1 UNIT — the determinism scanners themselves.
 *
 * This is the level that automates the FAILURE path. The security-level gate
 * (tests/security/determinism.invariant.test.ts) can only ever show the
 * scanners passing, because the real source is conformant. Here each scanner
 * is fed a deliberately-broken fixture and MUST report the violation — so if a
 * future refactor quietly declaws a scanner (a regex that stops matching, an
 * allowlist that swallows everything), these tests go red even though the
 * repo-wide gate would still be green.
 *
 * Coverage rule for this level: every scanner has a matched PASS/FAIL pair.
 * A scanner with only a PASS case does not count as covered.
 */
import { describe, it, expect } from 'vitest';
import {
  scanOrderByDeterminism,
  scanForbiddenRandomness,
  scanInferenceImports,
  scanAll,
  UNIQUE_BY_CONSTRUCTION,
} from '../support/determinism-scan';

// ===========================================================================
// Rule 1 — ORDER BY tiebreakers
// ===========================================================================
describe('scanOrderByDeterminism | PASS path', () => {
  it('accepts a clause ending in a primary key', () => {
    expect(scanOrderByDeterminism('`ORDER BY t.artist ASC, t.id ASC`')).toEqual([]);
  });

  it('accepts a bare id as the final term', () => {
    expect(scanOrderByDeterminism('`ORDER BY created_at DESC, id ASC`')).toEqual([]);
  });

  it('accepts an allowlisted unique-by-construction key', () => {
    expect(scanOrderByDeterminism('`ORDER BY decade DESC LIMIT 10`')).toEqual([]);
  });

  it('every allowlist entry carries a stated reason', () => {
    for (const [key, reason] of Object.entries(UNIQUE_BY_CONSTRUCTION)) {
      expect(reason, `allowlist entry "${key}" needs a reason`).toBeTruthy();
      expect(reason.length).toBeGreaterThan(15);
    }
  });
});

describe('scanOrderByDeterminism | FAIL path (born red)', () => {
  it('flags a tie-unstable top-N — the leaderboard failure mode', () => {
    const v = scanOrderByDeterminism('`ORDER BY attribution_count DESC LIMIT 10`');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('order-by-tiebreaker');
    expect(v[0].detail).toContain('attribution_count');
  });

  it('flags a non-unique single-column sort', () => {
    expect(scanOrderByDeterminism('`ORDER BY c.name ASC`')).toHaveLength(1);
  });

  it('flags a multi-term clause whose FINAL term is non-unique', () => {
    // The trap: leading terms look precise, the last one still ties.
    expect(scanOrderByDeterminism('`ORDER BY t.artist ASC, t.name ASC`')).toHaveLength(1);
  });

  it('reports a line number so the failure is actionable', () => {
    const src = 'line one\nline two\n`ORDER BY track_count DESC`';
    expect(scanOrderByDeterminism(src)[0].line).toBe(3);
  });

  it('flags every offender, not just the first', () => {
    const src = '`ORDER BY a_count DESC LIMIT 5`\n`ORDER BY b_name ASC`';
    expect(scanOrderByDeterminism(src)).toHaveLength(2);
  });
});

// ===========================================================================
// Rule 2 — forbidden randomness
// ===========================================================================
describe('scanForbiddenRandomness | PASS path', () => {
  it('permits crypto.randomUUID — identifier minting, not output ordering', () => {
    expect(scanForbiddenRandomness('const id = crypto.randomUUID();')).toEqual([]);
  });

  it('permits getRandomValues — PKCE verifier material', () => {
    expect(scanForbiddenRandomness('crypto.getRandomValues(array);')).toEqual([]);
  });
});

describe('scanForbiddenRandomness | FAIL path (born red)', () => {
  it('flags Math.random()', () => {
    const v = scanForbiddenRandomness('const pick = Math.random();');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('forbidden-randomness');
  });

  it('flags ORDER BY RANDOM()', () => {
    expect(scanForbiddenRandomness('`SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1`')).toHaveLength(1);
  });
});

// ===========================================================================
// Rule 3 — inference in the request path
// ===========================================================================
describe('scanInferenceImports | PASS path', () => {
  it('accepts a source with no model call', () => {
    expect(scanInferenceImports("import { z } from 'zod';")).toEqual([]);
  });

  it('does not flag a vendor named in a comment — prose is not a request path', () => {
    expect(scanInferenceImports('// we deliberately do not use openai here')).toEqual([]);
    expect(scanInferenceImports(' * Unlike OpenAI-backed catalogs, this is human-curated.')).toEqual([]);
  });
});

describe('scanInferenceImports | FAIL path (born red)', () => {
  it('flags an SDK import', () => {
    const v = scanInferenceImports("import Anthropic from '@anthropic-ai/sdk';");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('inference-import');
  });

  it('flags a Workers AI binding', () => {
    expect(scanInferenceImports('const out = await env.AI.run(model, input);')).toHaveLength(1);
  });

  it('flags a direct API endpoint', () => {
    expect(scanInferenceImports("fetch('https://api.openai.com/v1/chat/completions')").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Composite
// ===========================================================================
describe('scanAll', () => {
  it('returns no violations for conformant source', () => {
    expect(scanAll('const id = crypto.randomUUID();\n`ORDER BY t.name ASC, t.id ASC`')).toEqual([]);
  });

  it('aggregates violations across all three rules', () => {
    const broken = [
      "import OpenAI from 'openai';",
      'const r = Math.random();',
      '`ORDER BY count DESC LIMIT 10`',
    ].join('\n');
    const rules = new Set(scanAll(broken).map((v) => v.rule));
    expect(rules).toEqual(
      new Set(['inference-import', 'forbidden-randomness', 'order-by-tiebreaker']),
    );
  });
});
