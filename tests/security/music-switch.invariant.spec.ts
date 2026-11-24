/**
 * Music switch invariant (OW-224, step 7 of OSE-2222; src/lib/music-switch.ts).
 *
 * ourWKRP launches without its music slice. The switch is "off" only when the
 * deployed config says so, so both deployed environments must keep saying it:
 * staging ([vars]) and production ([env.production.vars]). The local e2e config
 * says "on", so the e2e journeys keep covering the music code, and CI runs the
 * page smoke a second time with music off. The 2026-11-23 SPOTIFY_AND_DJ
 * setting it replaced must not come back beside it.
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

describe('music switch: music stays off in every deployed environment', () => {
  const toml = read('wrangler.toml');

  it('staging [vars] says MUSIC_ENABLED = "off"', () => {
    expect(varIn(toml, 'vars', 'MUSIC_ENABLED')).toBe('off');
  });

  it('production [env.production.vars] says MUSIC_ENABLED = "off"', () => {
    expect(varIn(toml, 'env.production.vars', 'MUSIC_ENABLED')).toBe('off');
  });

  it('the local e2e config says "on", so the music code stays covered', () => {
    expect(varIn(read('wrangler.e2e.toml'), 'vars', 'MUSIC_ENABLED')).toBe('on');
  });

  it('the old SPOTIFY_AND_DJ setting is gone, so one setting decides', () => {
    for (const file of ['wrangler.toml', 'wrangler.e2e.toml', 'src/types.ts']) {
      expect(read(file), file).not.toContain('SPOTIFY_AND_DJ');
    }
  });

  it('the router consults the switch before dispatching', () => {
    const router = read('src/router.ts');
    expect(router).toMatch(/musicOff\(env\) && isMusicPath\(path\)/);
    expect(router.indexOf('isMusicPath(path)')).toBeLessThan(router.indexOf("path === '/health'"));
  });

  it('every page goes through the switch', () => {
    expect(read('src/handlers/pages.ts')).toMatch(/applyMusicSwitch\(html, musicOff\(env\)\)/);
  });

  it('CI runs the page smoke with music on and with music off', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name: Tier-1 page smoke \(music on\)/);
    expect(ci).toMatch(/name: Tier-1 page smoke \(music off\)[\s\S]*?MUSIC_ENABLED: 'off'/);
    expect(read('playwright.config.ts')).toContain('--var MUSIC_ENABLED:off');
  });
});
