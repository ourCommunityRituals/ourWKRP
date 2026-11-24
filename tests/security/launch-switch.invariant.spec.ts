/**
 * Launch switch invariant (owner decision, 2026-11-23; src/lib/launch-switch.ts).
 *
 * ourWKRP launches without Spotify and DJ. The switch is "off" only when the
 * deployed config says so, so both deployed environments must keep saying it:
 * staging ([vars]) and production ([env.production.vars]). The local e2e config
 * leaves it unset, so the e2e journeys keep covering the kept code.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf-8');

/** The quoted value of `key` in one TOML table. Plain line comparison. */
function varIn(text: string, table: string, key: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `[${table}]`);
  if (start === -1) return undefined;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith('[')) return undefined;
    const eq = line.indexOf('=');
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim();
    return value.startsWith('"') ? value.slice(1, value.indexOf('"', 1)) : undefined;
  }
  return undefined;
}

describe('launch switch: Spotify and DJ stay off in every deployed environment', () => {
  const toml = read('wrangler.toml');

  it('staging [vars] says SPOTIFY_AND_DJ = "off"', () => {
    expect(varIn(toml, 'vars', 'SPOTIFY_AND_DJ')).toBe('off');
  });

  it('production [env.production.vars] says SPOTIFY_AND_DJ = "off"', () => {
    expect(varIn(toml, 'env.production.vars', 'SPOTIFY_AND_DJ')).toBe('off');
  });

  it('the local e2e config does not switch it off, so the kept code stays covered', () => {
    expect(varIn(read('wrangler.e2e.toml'), 'vars', 'SPOTIFY_AND_DJ')).toBeUndefined();
  });

  it('the router consults the switch before dispatching', () => {
    const router = read('src/router.ts');
    expect(router).toMatch(/spotifyAndDjOff\(env\) && isSpotifyOrDjRoute\(method, path\)/);
  });
});
