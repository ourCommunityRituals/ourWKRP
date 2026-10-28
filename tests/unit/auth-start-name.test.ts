import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/types';
import { handleAuthStart } from '../../src/handlers/auth-start';

// CodeQL js/incomplete-multi-character-sanitization: a one-pass tag strip let
// nested tags reassemble into <script>. Names with angle brackets or control
// characters are now rejected outright; ordinary names still proceed.

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string>; put: ReturnType<typeof vi.fn> };
}

function mockEnv(kv: KVNamespace): Env {
  return {
    WKRP_KV: kv,
    WKRP_DB: {} as D1Database,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    LASTFM_API_KEY: 'test',
    LASTFM_SHARED_SECRET: 'test',
  };
}

function startRequest(name: string): Request {
  const url = new URL('http://localhost:8787/auth/start');
  url.searchParams.set('name', name);
  url.searchParams.set('gen', 'founder');
  return new Request(url.toString());
}

describe('handleAuthStart name validation', () => {
  let kv: ReturnType<typeof createMockKV>;
  let env: Env;

  beforeEach(() => {
    kv = createMockKV();
    env = mockEnv(kv);
  });

  const hostile: Array<[string, string]> = [
    ['nested tags', '<scr<b>ipt>alert(1)</scr</b>ipt>'],
    ['doubled bracket', '<<a>script>'],
    ['plain tag', '<b>'],
    ['tag around text', 'Ada <b>Lovelace</b>'],
    ['lone >', 'a > b'],
    ['NUL control char', 'Ada\u0000Lovelace'],
    ['newline control char', 'Ada\nLovelace'],
    ['DEL control char', 'Ada\u007FLovelace'],
  ];

  for (const [label, name] of hostile) {
    it(`rejects ${label} with 400 and stores nothing`, async () => {
      const res = await handleAuthStart(startRequest(name), env);
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Name contains invalid characters');
      expect(kv.put).not.toHaveBeenCalled();
    });
  }

  const benign = ['Ada Lovelace', "DJ O'Brien", 'Zoë 李', 'A & B'];

  for (const name of benign) {
    it(`accepts ${JSON.stringify(name)} unchanged and redirects`, async () => {
      const res = await handleAuthStart(startRequest(name), env);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toMatch(/^https:\/\/accounts\.spotify\.com\//);
      expect(kv.put).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(kv.put.mock.calls[0][1] as string) as { name: string };
      expect(stored.name).toBe(name);
    });
  }

  it('still rejects a whitespace-only name', async () => {
    const res = await handleAuthStart(startRequest('   '), env);
    expect(res.status).toBe(400);
    expect(kv.put).not.toHaveBeenCalled();
  });
});
