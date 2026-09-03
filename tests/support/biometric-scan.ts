/**
 * Biometric absence scanners — invariant #27 no_biometric_identifiers.
 *
 * WHY PURE FUNCTIONS
 * An absence gate is the weakest kind of test: it passes when it finds
 * nothing, which is also what it does when it has been broken. Extracting the
 * scan as `(source: string) => Violation[]` lets the unit level feed each
 * scanner a deliberately-broken fixture and require a report — so the gate
 * cannot silently declaw itself. Same pattern as tests/support/determinism-scan.ts.
 *
 * WHAT IS BEING PROTECTED
 * 740 ILCS 14 (Illinois BIPA) attaches a private right of action and statutory
 * damages — $1,000 negligent, $5,000 intentional/reckless, no proof of harm —
 * to collection of retina/iris scans, fingerprints, voiceprints, and scans of
 * hand or face geometry. OCR has no BIPA surface because it never built one:
 * a QR scan is not a biometric identifier, an anonymous cookie is not, and a
 * k-floored aggregate contains none.
 *
 * The realistic hazard is not a decision to collect biometrics. It is a camera
 * on the venue Display for "audience measurement", or a people-counter SDK
 * that ships face detection inside it — a change that reads like an
 * improvement in review and converts a clean product into a defendant.
 */

export interface BiometricViolation {
  rule: 'media-capture' | 'biometric-vendor' | 'biometric-field';
  detail: string;
  line?: number;
}

/** Comment-stripped view of a line; keeps URL scheme slashes intact. */
function code(text: string): string {
  return text.replace(/(?<!:)\/\/.*$/, '').replace(/^\s*\*.*$/, '');
}

// ---------------------------------------------------------------------------
// Rule 1 — no camera or microphone acquisition, on any surface.
// ---------------------------------------------------------------------------
/**
 * Includes the venue Display explicitly: it is the surface most likely to
 * attract a camera-based audience-measurement proposal, and the one where a
 * camera would look most reasonable.
 */
const MEDIA_PATTERNS: Array<[RegExp, string]> = [
  [/\bgetUserMedia\b/, 'getUserMedia — camera/microphone stream'],
  [/\bgetDisplayMedia\b/, 'getDisplayMedia — screen/media capture'],
  [/\bnavigator\s*\.\s*mediaDevices\b/, 'navigator.mediaDevices'],
  [/\bnew\s+MediaRecorder\b/, 'MediaRecorder — media capture'],
  [/<\s*video\b/i, '<video> element — capture surface'],
  [/<\s*audio\b/i, '<audio> element — capture surface'],
  [/<input[^>]*\bcapture\s*=/i, '<input capture> — device capture'],
  [/\bAudioContext\b|\bwebkitAudioContext\b/, 'AudioContext — audio acquisition'],
];

export function scanMediaCapture(source: string): BiometricViolation[] {
  const out: BiometricViolation[] = [];
  source.split('\n').forEach((text, i) => {
    const c = code(text);
    for (const [re, label] of MEDIA_PATTERNS) {
      if (re.test(c)) {
        out.push({
          rule: 'media-capture',
          detail: `${label} — audience measurement is QR + anonymous cookie only (invariant #27).`,
          line: i + 1,
        });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rule 2 — no biometric vendor SDK, service, or endpoint.
// ---------------------------------------------------------------------------
const VENDOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bface-?api\b/i, 'face-api'],
  // No trailing \b: the SDK is used as `RekognitionClient`, and a word
  // boundary after "rekognition" would never match the common form.
  [/rekognition/i, 'AWS Rekognition'],
  [/cognitiveservices[^\s'"]*\/face/i, 'Azure Face API'],
  [/vision\.googleapis\.com/i, 'Google Cloud Vision'],
  [/speech\.googleapis\.com/i, 'Google Speech-to-Text'],
  [/\bclarifai\b/i, 'Clarifai'],
  [/\bkairos\b/i, 'Kairos face recognition'],
  [/\bluxand\b/i, 'Luxand face SDK'],
  [/\bmediapipe\b/i, 'MediaPipe (face/hand landmark)'],
  [/\bfaceDetector\b|\bFaceDetector\b/, 'FaceDetector API'],
  [/\bspeaker[_-]?id(entification)?\b/i, 'speaker identification'],
];

export function scanBiometricVendors(source: string): BiometricViolation[] {
  const out: BiometricViolation[] = [];
  source.split('\n').forEach((text, i) => {
    const c = code(text);
    for (const [re, label] of VENDOR_PATTERNS) {
      if (re.test(c)) {
        out.push({
          rule: 'biometric-vendor',
          detail: `${label} — biometric vendor SDK/endpoint referenced (invariant #27).`,
          line: i + 1,
        });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rule 3 — no BIPA-enumerated identifier used as a data field.
// ---------------------------------------------------------------------------
/**
 * The statute enumerates: retina/iris scan, fingerprint, voiceprint, and scan
 * of hand or face geometry. Matched as field/identifier shapes rather than
 * loose words so that prose discussing the statute does not trip the gate —
 * this file, and the invariant text itself, must not be self-flagging.
 */
const FIELD_PATTERNS: Array<[RegExp, string]> = [
  [/\bvoice_?print\b/i, 'voiceprint'],
  [/\bface_?print\b/i, 'faceprint'],
  [/\bface_?geometry\b/i, 'face geometry'],
  [/\bhand_?geometry\b/i, 'hand geometry'],
  [/\b(retina|iris)_?scan\b/i, 'retina/iris scan'],
  [/\bfinger_?print_?(id|hash|template|data)\b/i, 'fingerprint template'],
  [/\bbiometric_?(id|data|identifier|template|hash)\b/i, 'biometric identifier field'],
];

export function scanBiometricFields(source: string): BiometricViolation[] {
  const out: BiometricViolation[] = [];
  source.split('\n').forEach((text, i) => {
    const c = code(text);
    for (const [re, label] of FIELD_PATTERNS) {
      if (re.test(c)) {
        out.push({
          rule: 'biometric-field',
          detail: `${label} — a 740 ILCS 14 enumerated identifier used as data (invariant #27).`,
          line: i + 1,
        });
      }
    }
  });
  return out;
}

export function scanBiometrics(source: string): BiometricViolation[] {
  return [
    ...scanMediaCapture(source),
    ...scanBiometricVendors(source),
    ...scanBiometricFields(source),
  ];
}
