/**
 * Architectural invariant #26 — explicit_identity
 *
 * Brain:     ourCommunityRituals/OCR-docs → architectural-invariants.yaml #26
 *            (group privacy_identity, group_order 4, status partial)
 * Contract:  product-registry.yaml → products[wkrp].identity_contract
 * Checker:   ocr-docs-brain/scripts/check_brain_contract.py
 *            check_identity_layer_contract (non-anonymous branch)
 * Mirror of: #1 anonymous_id — read the two as one contract in two halves.
 *
 * WHY THIS EXISTS
 * ourWKRP is the named half of the choice contract. OSE guarantees you can be
 * present without a flag; WKRP guarantees you can plant one — deliberately,
 * without it ever migrating to the anonymous side, and with the ability to
 * pull it back out. Before #26 the brain had no contract for this half at all:
 * check_identity_layer_contract returned an unconditional PASS for any product
 * whose identity_layer was not 'anonymous', so every conformance run on this
 * repo was green by definition regardless of what the code did.
 *
 * This file is the repo-side structural gate for the four walls. It is a
 * static/string spec with no yaml dependency, mirroring the L0 pattern of #1
 * and #8 and of security-control-wiring.invariant.test.ts in this directory.
 * Its runtime complement is tests/e2e/anonymous-journey.spec.ts (wall b) and
 * the deployed-worker assertions named in the brain activation_criterion —
 * until those are green, #26 stays `partial`.
 *
 *   (a) AFFIRMATIVE BIRTH     — identity is minted only by a declared consent
 *                               entrypoint; nothing else creates a contributor.
 *   (b) INTACT ANONYMOUS RUNG — public surfaces stay reachable with no session.
 *   (c) STRIPPED EGRESS       — identity never crosses the boundary un-stripped.
 *   (d) REVOCABLE FLAG        — erasure severs the person, preserves provenance.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Mirrors product-registry.yaml → products[wkrp].identity_contract. */
const CONSENT_ENTRYPOINTS = [
  'src/handlers/auth-register.ts',
  'src/handlers/auth-callback.ts',
];
const BOUNDARY_MODULE = 'src/lib/privacy.ts';
const ERASURE_MODULE = 'src/lib/erasure.ts';
const ANONYMOUS_RUNG_SPEC = 'tests/e2e/anonymous-journey.spec.ts';
const STRIP_SYMBOLS = ['stripListenerPII', 'sanitizeForExport'];

/** Every src/ TypeScript file, so the walls can be asserted as closed sets. */
function srcFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...srcFiles(rel));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

// ===========================================================================
// Wall (a) — AFFIRMATIVE BIRTH
// Identity is born only from an act the person initiated. Asserted as a
// CLOSED SET: if a new code path ever inserts a contributor row, this fails
// until that path is declared a consent entrypoint in the brain registry.
// ===========================================================================
describe('#26 wall (a) — identity is born only from an affirmative act', () => {
  it('only the declared consent entrypoints create a contributor identity', () => {
    const creators = srcFiles().filter((f) => read(f).includes('INSERT INTO contributors'));
    expect(creators.sort()).toEqual([...CONSENT_ENTRYPOINTS].sort());
  });

  it('every declared consent entrypoint exists', () => {
    for (const ep of CONSENT_ENTRYPOINTS) expect(exists(ep)).toBe(true);
  });

  it('registration is an explicit act, not a side effect of a request', () => {
    // The consent is the POST body the person submitted, validated first.
    const register = read('src/handlers/auth-register.ts');
    expect(register).toContain('registerBodySchema');
    expect(register).toContain('validateBody');
  });

  it('the OAuth entrypoint mints identity only after a completed callback', () => {
    const callback = read('src/handlers/auth-callback.ts');
    expect(callback).toContain('INSERT INTO contributors');
    // A code exchange the person completed — not an ambient visit.
    expect(callback).toMatch(/exchangeCodeForToken|code/);
  });
});

// ===========================================================================
// Wall (b) — INTACT ANONYMOUS RUNG
// The anonymous rung must stay whole. A public surface that starts demanding
// a session converts the choice into a default.
// ===========================================================================
describe('#26 wall (b) — the anonymous rung stays intact', () => {
  it('the anonymous journey spec exists', () => {
    expect(exists(ANONYMOUS_RUNG_SPEC)).toBe(true);
  });

  it('the anonymous journey proves browsing creates no identity', () => {
    const spec = read(ANONYMOUS_RUNG_SPEC);
    expect(spec).toContain('browsing never creates a contributor identity');
    // The boundary assertion: after browsing, there is still no session.
    expect(spec).toContain('/auth/session/me');
    expect(spec).toContain('expect(session.status()).toBe(401)');
  });

  it('the public catalog surface never requires a session', () => {
    const catalog = read('src/handlers/catalog.ts');
    expect(catalog).not.toContain('requireSession');
    expect(catalog).not.toContain('getSessionToken');
  });
});

// ===========================================================================
// Wall (c) — STRIPPED EGRESS
// Named identity never crosses the OER boundary un-stripped. Complements
// brain #17 (what may be emitted) and #22 (no module-level coupling).
// ===========================================================================
describe('#26 wall (c) — identity is stripped before it leaves the product', () => {
  it('the boundary module exists and defines every declared strip symbol', () => {
    expect(exists(BOUNDARY_MODULE)).toBe(true);
    const privacy = read(BOUNDARY_MODULE);
    for (const symbol of STRIP_SYMBOLS) {
      expect(privacy).toContain(`export function ${symbol}`);
    }
  });

  it('stripping removes listener identity, not just the id', () => {
    const privacy = read(BOUNDARY_MODULE);
    for (const field of ['listener_id', 'listener_name', 'listener_email']) {
      expect(privacy).toContain(`delete cleaned.${field}`);
    }
  });

  it('the cross-product boundary is detectable, so egress can be gated', () => {
    expect(read(BOUNDARY_MODULE)).toContain('export function isCrossProductRequest');
  });
});

// ===========================================================================
// Wall (d) — REVOCABLE FLAG
// The flag can always be pulled back out. Tombstone, never delete: the person
// is severed while the opaque id keeps the provenance chain intact.
// ===========================================================================
describe('#26 wall (d) — the flag is always revocable', () => {
  it('the erasure module exists', () => {
    expect(exists(ERASURE_MODULE)).toBe(true);
  });

  it('erasure tombstones the identity rather than deleting the row', () => {
    const erasure = read(ERASURE_MODULE);
    expect(erasure).toContain('UPDATE contributors');
    expect(erasure).not.toContain('DELETE FROM contributors');
    expect(erasure).toContain("status = 'departed'");
  });

  it('erasure nulls the identifying columns', () => {
    const erasure = read(ERASURE_MODULE);
    for (const col of ['spotify_user_id', 'spotify_display_name', 'lastfm_username']) {
      expect(erasure).toContain(`${col} = NULL`);
    }
  });

  it('erasure purges the KV identity material', () => {
    const erasure = read(ERASURE_MODULE);
    expect(erasure).toContain('deleteTokens');
    expect(erasure).toContain('deleteLastfmSession');
  });

  it('erasure is recorded in the audit trail', () => {
    expect(read(ERASURE_MODULE)).toContain("action: 'privacy.erasure'");
  });
});

// ===========================================================================
// Cross-wall — the audit trail must not reintroduce the identity it severed.
// ===========================================================================
describe('#26 — the audit trail records actors opaquely', () => {
  it('audit actorId is an opaque id or null, never a name', () => {
    const audit = read('src/lib/audit.ts');
    expect(audit).toContain('actorId?: string | null');
    expect(audit).not.toMatch(/actorName|actorEmail|actorDisplayName/);
  });

  it('audit metadata passes through the redactor before persistence', () => {
    expect(read('src/lib/audit.ts')).toContain('redact');
  });
});
