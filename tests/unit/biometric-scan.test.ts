/**
 * L1 UNIT — the biometric absence scanners themselves (invariant #27).
 *
 * This is the level that automates the FAILURE path. The L0 gate over real
 * source can only ever show these scanners passing, because the tree is clean —
 * and an absence gate that passes is indistinguishable from an absence gate
 * that is broken. Here each scanner is fed a deliberately-broken fixture and
 * MUST report.
 *
 * Coverage rule: every scanner has a matched PASS/FAIL pair. A scanner with
 * only a PASS case is not covered.
 */
import { describe, it, expect } from 'vitest';
import {
  scanMediaCapture,
  scanBiometricVendors,
  scanBiometricFields,
  scanBiometrics,
} from '../support/biometric-scan';

// ===========================================================================
// Rule 1 — media capture
// ===========================================================================
describe('scanMediaCapture | PASS path', () => {
  it('accepts ordinary worker source', () => {
    expect(scanMediaCapture("const id = crypto.randomUUID();")).toEqual([]);
  });

  it('does not flag prose that merely names the hazard', () => {
    expect(scanMediaCapture('// we deliberately never call getUserMedia')).toEqual([]);
    expect(scanMediaCapture(' * No camera: getUserMedia is forbidden by #27.')).toEqual([]);
  });
});

describe('scanMediaCapture | FAIL path (born red)', () => {
  it('flags a camera stream', () => {
    const v = scanMediaCapture('const s = await navigator.mediaDevices.getUserMedia({ video: true });');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].rule).toBe('media-capture');
  });

  it('flags a MediaRecorder', () => {
    expect(scanMediaCapture('const r = new MediaRecorder(stream);')).toHaveLength(1);
  });

  it('flags a <video> element — the Display/TV hazard', () => {
    expect(scanMediaCapture('<video id="audience-cam" autoplay></video>')).toHaveLength(1);
  });

  it('flags an <input capture> attribute', () => {
    expect(scanMediaCapture('<input type="file" accept="image/*" capture="user">')).toHaveLength(1);
  });

  it('reports a line number so the failure is actionable', () => {
    expect(scanMediaCapture('a\nb\nnew MediaRecorder(s)')[0].line).toBe(3);
  });
});

// ===========================================================================
// Rule 2 — biometric vendors
// ===========================================================================
describe('scanBiometricVendors | PASS path', () => {
  it('accepts the actual runtime dependencies', () => {
    expect(scanBiometricVendors("import { z } from 'zod';")).toEqual([]);
  });
});

describe('scanBiometricVendors | FAIL path (born red)', () => {
  it('flags a face SDK import', () => {
    const v = scanBiometricVendors("import * as faceapi from 'face-api.js';");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('biometric-vendor');
  });

  it('flags a cloud vision endpoint', () => {
    expect(scanBiometricVendors("fetch('https://vision.googleapis.com/v1/images:annotate')")).toHaveLength(1);
  });

  it('flags AWS Rekognition', () => {
    expect(scanBiometricVendors("const r = new RekognitionClient({});")).toHaveLength(1);
  });
});

// ===========================================================================
// Rule 3 — BIPA-enumerated identifiers as data
// ===========================================================================
describe('scanBiometricFields | PASS path', () => {
  it('does not flag prose about the statute', () => {
    // The invariant text and this suite must not be self-flagging.
    expect(scanBiometricFields('740 ILCS 14 enumerates retina, iris, and hand geometry.')).toEqual([]);
  });

  it('does not flag unrelated uses of the word fingerprint', () => {
    expect(scanBiometricFields('// audio fingerprinting of recordings, not people')).toEqual([]);
  });
});

describe('scanBiometricFields | FAIL path (born red)', () => {
  it('flags a voiceprint field', () => {
    const v = scanBiometricFields('ALTER TABLE attendees ADD COLUMN voiceprint BLOB;');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('biometric-field');
  });

  it('flags face geometry', () => {
    expect(scanBiometricFields('const face_geometry = detect(frame);')).toHaveLength(1);
  });

  it('flags a generic biometric identifier column', () => {
    expect(scanBiometricFields('biometric_template TEXT NOT NULL')).toHaveLength(1);
  });
});

// ===========================================================================
// Composite
// ===========================================================================
describe('scanBiometrics', () => {
  it('is clean for conformant source', () => {
    expect(scanBiometrics('const brandId = extractBrandId(request);')).toEqual([]);
  });

  it('aggregates across all three rules', () => {
    const broken = [
      "import * as faceapi from 'face-api.js';",
      'await navigator.mediaDevices.getUserMedia({ video: true });',
      'const voiceprint = capture();',
    ].join('\n');
    const rules = new Set(scanBiometrics(broken).map((v) => v.rule));
    expect(rules).toEqual(new Set(['biometric-vendor', 'media-capture', 'biometric-field']));
  });
});
