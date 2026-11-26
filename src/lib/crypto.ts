/**
 * Data-at-rest encryption for KV-stored secrets (F2 auth hardening, 2026-09-12).
 *
 * Long-lived third-party credentials — Spotify access/refresh tokens
 * (wkrp:tokens:*) and Last.fm session keys (wkrp:lastfm:*) — were stored as
 * plaintext JSON in KV, so a KV read was full account takeover. This wraps them
 * in AES-256-GCM using a key from `env.WKRP_ENCRYPTION_KEY` (a base64 32-byte
 * secret), mirroring OSE's data-at-rest doctrine.
 *
 * Since CCR F12 (2026-11-26) the key is mandatory:
 *   - write: always encrypted. With no key, sealJSON throws
 *     MissingEncryptionKeyError and nothing is stored: a credential is never
 *     written to KV in plain text.
 *   - read:  values are self-describing via the `enc:v1:` prefix — decrypt when
 *     prefixed (key required). A legacy plaintext value is still readable, and
 *     the kv-storage getters re-seal it the first time it is read with a key.
 */

/** Thrown when a credential would be stored without WKRP_ENCRYPTION_KEY. */
export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('WKRP_ENCRYPTION_KEY is not set; refusing to store a credential in plain text (CCR F12)');
    this.name = 'MissingEncryptionKeyError';
  }
}

const ENC_PREFIX = 'enc:v1:';
const IV_BYTES = 12; // AES-GCM standard nonce length

/** True if a stored value is one this module encrypted. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyB64.trim());
  if (raw.length !== 32) {
    throw new Error(`WKRP_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a UTF-8 string → `enc:v1:<base64(iv||ciphertext)>`. */
export async function encryptString(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(IV_BYTES + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), IV_BYTES);
  return ENC_PREFIX + bytesToB64(packed);
}

/** Decrypt a value produced by encryptString. Throws on tamper/wrong key. */
export async function decryptString(stored: string, keyB64: string): Promise<string> {
  const packed = b64ToBytes(stored.slice(ENC_PREFIX.length));
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Serialize + encrypt. Used on every credential write path. Throws
 * MissingEncryptionKeyError when no key is set (CCR F12), so a missing secret
 * stops the write instead of leaving a plaintext credential in KV.
 */
export async function sealJSON(value: unknown, keyB64: string | undefined): Promise<string> {
  if (!keyB64 || !keyB64.trim()) throw new MissingEncryptionKeyError();
  return encryptString(JSON.stringify(value), keyB64);
}

/**
 * Read a stored value, and re-seal it in place when it is legacy plaintext and
 * a key is available (CCR F12 migration: each credential is upgraded the first
 * time it is read after the key is set). Returns null for a missing value.
 */
export async function openAndUpgrade<T>(
  kv: KVNamespace,
  kvKey: string,
  keyB64: string | undefined,
): Promise<T | null> {
  const raw = await kv.get(kvKey);
  if (!raw) return null;
  const value = await openJSON<T>(raw, keyB64);
  if (!isEncrypted(raw) && keyB64) {
    await kv.put(kvKey, await sealJSON(value, keyB64));
  }
  return value;
}

/**
 * Read path: transparently handle both ciphertext (needs the key) and legacy
 * plaintext JSON. Returns null when a value is encrypted but no key is
 * available — a fail-safe that surfaces misconfiguration rather than crashing.
 */
export async function openJSON<T>(stored: string, keyB64: string | undefined): Promise<T | null> {
  if (isEncrypted(stored)) {
    if (!keyB64) return null; // encrypted at rest but key not provisioned
    return JSON.parse(await decryptString(stored, keyB64)) as T;
  }
  return JSON.parse(stored) as T; // legacy plaintext
}
