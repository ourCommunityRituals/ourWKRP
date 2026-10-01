/**
 * OW-152 — staging and production never share a KV namespace, a D1 database or a host.
 *
 * Until OW-152, `[env.production]` bound WKRP_KV to aa9de79e…, the namespace
 * titled `ourwkrp-staging-WKRP_KV`. Sessions, Spotify/Last.fm tokens, OAuth
 * state and rate-limit counters all live in WKRP_KV, so a staging session was
 * valid in production. This test reads wrangler.toml and fails when:
 *   - any KV or D1 id bound in production is also bound in staging, or
 *   - a production route is a wildcard, or matches the staging host.
 *
 * Staging is the top-level (default) env; production is `[env.production]`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf-8');

interface Block {
  header: string;
  keys: Record<string, string>;
}

/** Split wrangler.toml into [table] / [[array]] blocks with their quoted string keys. */
function blocks(src: string): Block[] {
  const out: Block[] = [{ header: '', keys: {} }];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const h = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (h) {
      out.push({ header: h[1].trim(), keys: {} });
      continue;
    }
    const kv = /^([A-Za-z_]+)\s*=\s*"([^"]*)"/.exec(line);
    if (kv) out[out.length - 1].keys[kv[1]] = kv[2];
  }
  return out;
}

const all = blocks(toml);
const isProd = (b: Block) => b.header.startsWith('env.production');
const isEnv = (b: Block) => b.header.startsWith('env.');

/** Every KV id / preview_id and D1 database_id bound by one environment. */
function resourceIds(pick: (b: Block) => boolean): Map<string, string> {
  const ids = new Map<string, string>();
  for (const b of all.filter(pick)) {
    const kind = b.header.replace(/^env\.production\./, '');
    if (kind === 'kv_namespaces') {
      if (b.keys.id) ids.set(b.keys.id, `KV ${b.keys.binding}`);
      if (b.keys.preview_id) ids.set(b.keys.preview_id, `KV ${b.keys.binding} (preview)`);
    }
    if (kind === 'd1_databases' && b.keys.database_id) {
      ids.set(b.keys.database_id, `D1 ${b.keys.binding} (${b.keys.database_name})`);
    }
  }
  return ids;
}

const staging = resourceIds((b) => !isEnv(b));
const production = resourceIds(isProd);

/** Route patterns in a `routes = [...]` array that follows the given marker. */
function routePatterns(section: string): string[] {
  return [...section.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
}

const prodStart = toml.search(/^\[env\.production\][ \t]*\r?$/m);
const prodSection = prodStart === -1 ? '' : toml.slice(prodStart);
const nextTable = prodSection.slice(1).search(/^\[/m);
/** The host part of a route pattern (everything before the first '/'). */
const hostOf = (pattern: string) => pattern.split('/')[0];

/** Patterns whose HOST contains a wildcard in any spelling (`*.x`, `*x`, `a*.x`). */
function wildcardHosts(patterns: string[]): string[] {
  return patterns.filter((p) => hostOf(p).includes('*'));
}

const prodRoutes = routePatterns(nextTable === -1 ? prodSection : prodSection.slice(0, nextTable + 1));
const stagingRoutes = routePatterns(prodStart === -1 ? toml : toml.slice(0, prodStart));

describe('OW-152 | staging and production are isolated in wrangler.toml', () => {
  it('parses both environments (guards against a vacuous pass)', () => {
    expect([...staging.values()]).toEqual(expect.arrayContaining(['KV WKRP_KV']));
    expect([...production.values()]).toEqual(expect.arrayContaining(['KV WKRP_KV']));
    expect([...staging.values()].some((v) => v.startsWith('D1 WKRP_DB'))).toBe(true);
    expect([...production.values()].some((v) => v.startsWith('D1 WKRP_DB'))).toBe(true);
    expect(prodRoutes.length).toBeGreaterThan(0);
    expect(stagingRoutes.length).toBeGreaterThan(0);
  });

  it('no KV or D1 id bound in production is also bound in staging', () => {
    const shared = [...production.keys()]
      .filter((id) => staging.has(id))
      .map((id) => `${production.get(id)} = ${id} (staging: ${staging.get(id)})`);
    expect(shared).toEqual([]);
  });

  it('the wildcard detector catches every host-wildcard spelling (not vacuous)', () => {
    expect(
      wildcardHosts(['*.ourwkrp.com/*', '*ourwkrp.com/*', 'st*.ourwkrp.com/*', 'ourwkrp.com/*'])
    ).toEqual(['*.ourwkrp.com/*', '*ourwkrp.com/*', 'st*.ourwkrp.com/*']);
  });

  it('production routes are explicit hosts, never a wildcard', () => {
    expect(wildcardHosts(prodRoutes)).toEqual([]);
  });

  it('no production route can match a staging host', () => {
    const stagingHosts = stagingRoutes.map(hostOf);
    const overlaps = prodRoutes.filter((p) => stagingHosts.includes(hostOf(p)));
    expect(overlaps).toEqual([]);
  });
});
