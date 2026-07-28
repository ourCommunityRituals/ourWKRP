/**
 * Architectural invariant (OW facet, PROPOSED) — cross_product_privacy_boundary
 *
 * OW is the NAMED / Individual pole of the Choice network (org OCR_VISION §6.5);
 * OSE is the anonymous / Group pole. Inside OW, contributors are identified by
 * voluntary attribution. But when data CROSSES to OSE or to a sponsor, listener
 * identity must NEVER cross — only aggregates. This is OW's mirror of brain
 * invariant #1 (anonymous_id) + #7 (aggregate_only_reporting), and the OW side of
 * ADR-002 explicit_identity (#15). Register centrally (applies_to wkrp) when the
 * ADR-002 schema lands; until then this is a per-repo L0 lock. See
 * docs/OCR_GATE_triangleConformance.md.
 *
 * WHY THIS EXISTS
 * The boundary is enforced by hand today — events.ts strips via sanitizeForExport;
 * sponsor.ts aggregates listeners as COUNT() by construction — with NO test
 * locking it. A future edit that adds a listener_id / listener_name / listener_email
 * field to a cross-product response would silently leak the named pole's listeners
 * into the anonymous pole. This spec is the L0 code-shape lock that makes that
 * drift fail CI. The T1 behavioral complement (drive the endpoints against a
 * seeded D1, assert zero listener identity in the payload) is a documented
 * follow-up, not yet written.
 *
 * NOTE: export.ts is deliberately NOT a cross-product handler — it is internal and
 * auth-gated (founder/curator/dj) and exposes contributor_name, which is
 * named-identity-by-design (the presenter rung), not listener PII.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

// Handlers whose responses can cross the OW→OSE / OW→sponsor boundary.
const CROSS_PRODUCT_HANDLERS = ['handlers/events.ts', 'handlers/sponsor.ts'];
// Listener-identity fields that must NEVER appear in a cross-product response.
const LISTENER_PII = ['listener_name', 'listener_email'];

describe('Invariant cross_product_privacy_boundary (OW facet) — listeners never cross to OSE/sponsors', () => {
  it('privacy.ts strips every listener identity field', () => {
    const p = read('lib/privacy.ts');
    expect(p).toMatch(/delete\s+\w+\.listener_id/);
    expect(p).toMatch(/delete\s+\w+\.listener_name/);
    expect(p).toMatch(/delete\s+\w+\.listener_email/);
  });

  it('the OSE-facing music endpoint applies the strip before responding', () => {
    expect(read('handlers/events.ts')).toMatch(/sanitizeForExport\s*\(/);
  });

  it('no cross-product handler references listener name or email anywhere', () => {
    for (const h of CROSS_PRODUCT_HANDLERS) {
      const src = read(h);
      for (const field of LISTENER_PII) {
        expect(src.includes(field), `${h} must not reference ${field} (listener PII cannot cross the boundary)`).toBe(false);
      }
    }
  });

  it('listener_id appears only inside COUNT() aggregates in cross-product handlers', () => {
    for (const h of CROSS_PRODUCT_HANDLERS) {
      read(h).split('\n').forEach((line, i) => {
        if (/listener_id/.test(line)) {
          expect(
            /COUNT\s*\(/i.test(line),
            `${h}:${i + 1} references listener_id outside a COUNT() aggregate — that would expose an individual listener:\n  ${line.trim()}`,
          ).toBe(true);
        }
      });
    }
  });

  it('the boundary mechanism (sanitizeForExport) is exported and actually used', () => {
    expect(read('lib/privacy.ts')).toMatch(/export function sanitizeForExport/);
    const used = CROSS_PRODUCT_HANDLERS.some((h) => /sanitizeForExport/.test(read(h)));
    expect(used, 'sanitizeForExport must be wired into at least one cross-product handler, not dead code').toBe(true);
  });
});
