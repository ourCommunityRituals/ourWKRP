// Seed a LOCAL OurSharedEvents worker from one creator file: one event per
// station that has an `event`, real poster placements, real scans through
// /q/<token> spread over the event's hours, the nightly roll-up, and a signed
// SharedReport link per event.
//
//   node showcase/seed-local.mjs <creator.json>
//
// The worker comes from start-local-ose.(ps1|sh), which writes
// showcase/local-ose.env.json (a throwaway key for that run; never committed).
// OSE_BASE and OSE_ADMIN_KEY in the environment win over the file.
// Refuses any base that is not 127.0.0.1 / localhost.
// Writes showcase/work/<slug>/reports.json: PRIVATE, it holds signed links.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertLocalBase, createPacer, hourBuckets, scansFor, SHAPES } from './lib/showcase.mjs';
import { SHOWCASE, readJson, loadCatalog } from './lib/build.mjs';
import { creatorProblems } from './lib/schema.mjs';

const creator = readJson(resolve(process.argv[2] ?? ''));
const problems = creatorProblems(creator, loadCatalog());
if (problems.length) throw new Error(`creator file refused:\n  ${problems.join('\n  ')}`);

const envFile = join(SHOWCASE, 'local-ose.env.json');
const local = existsSync(envFile) ? JSON.parse(readFileSync(envFile, 'utf8').replace(/^\s+/, '')) : {};
const BASE = assertLocalBase(process.env.OSE_BASE || local.base);
const ADMIN_KEY = process.env.OSE_ADMIN_KEY || local.adminKey;
if (!ADMIN_KEY) throw new Error('no local admin key: run start-local-ose first');
const H = { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paced = createPacer({ sleep });

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// In-process D1 through wrangler's Local Explorer, so nothing else opens the
// database file while the worker holds it.
const EXPLORER = `${BASE}/cdn-cgi/local/explorer/api`;
async function d1(sql, params = []) {
  const res = await fetch(`${EXPLORER}/d1/database/local/raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`d1 failed: ${JSON.stringify(body.errors)}`);
  const { columns = [], rows = [] } = body.result[0]?.results ?? {};
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// The local database exists only for this showcase run, so a rerun starts from no events.
const RESET_TABLES = ['event_codes', 'export_manifest', 'report_access_log', 'scan_aggregates', 'scan_cell_aggregates',
  'scan_node_returns', 'scan_placement_events', 'share_opens_daily', 'shortlinks', 'sponsor_displays', 'sponsor_placement',
  'poster_deployments'];

async function main() {
  for (const t of RESET_TABLES) await d1(`DELETE FROM ${t}`);
  await d1('DELETE FROM events');

  const types = await api('GET', '/api/v2/admin/event-types');
  const allTypes = types.categories.flatMap((c) => c.types.map((t) => ({ ...t, category: c.name ?? c.label ?? c.id })));
  const pickType = (kind) => {
    const k = kind.toLowerCase();
    const words = { class: ['class', 'workshop', 'lesson'], talk: ['talk', 'lecture', 'panel'], 'game night': ['game', 'trivia'],
      set: ['dj', 'music', 'concert', 'set'], 'pop-up': ['market', 'pop', 'vendor', 'fair'] }[k] ?? [k];
    const hit = allTypes.find((t) => words.some((w) => `${t.name ?? t.label ?? ''} ${t.id}`.toLowerCase().includes(w)));
    return (hit ?? allTypes[0]).id;
  };

  await api('PUT', '/api/v2/admin/flags/analytics.shared-report', { enabled: true });

  const out = [];
  let offset = -12;
  for (const st of creator.stations) {
    if (!st.event) continue;
    const shape = SHAPES[st.event.demo];
    const day = dayOffset(offset);
    offset += 2;
    const ev = await api('POST', '/api/v2/admin/events', {
      title: st.event.title,
      start_date: day,
      end_date: day,
      location: st.event.location ?? `${creator.name}: ${st.title}`,
      description: `Demo event for the ${creator.name} showcase (${st.name ?? st.id}).`,
      timezone: 'America/Los_Angeles',
      is_published: true,
    });
    await api('PUT', `/api/v2/admin/events/${ev.id}`, { status: 'ready', start_time: `${String(shape.hours[0]).padStart(2, '0')}:00`, event_type_id: pickType(st.event.kind) });
    await api('PUT', `/api/v2/admin/events/${ev.id}`, { status: 'active' });

    const placements = [];
    for (const label of shape.placements) {
      const pd = await api('POST', `/api/v2/admin/events/${ev.id}/poster-deployments`, {
        placement_label: label,
        placement_type: /door|room|table/i.test(label) ? 'venue' : 'community',
      });
      if (typeof pd.qr_token !== 'string') throw new Error(`contract: poster-deployments returned no qr_token for ${st.id}`);
      placements.push({ token: pd.qr_token, label });
    }

    // Real scans: no cookie on any request, so the worker mints a new anonymous id each time.
    const total = scansFor(shape);
    let sent = 0;
    for (let i = 0; i < total; i++) {
      const p = placements[i % placements.length];
      await paced();
      const res = await fetch(`${BASE}/q/${p.token}`, { redirect: 'manual', headers: { 'User-Agent': `showcase-demo/${i}` } });
      if (res.status === 302) sent++;
    }

    // Wait for buffered writes, then spread this event's scans over its hours.
    let rows = 0;
    for (let i = 0; i < 20; i++) {
      rows = (await d1('SELECT COUNT(*) AS n FROM scan_node_returns WHERE event_id = ?', [ev.id]))[0]?.n ?? 0;
      if (rows >= total) break;
      await sleep(500);
    }
    for (const { bucket, n } of hourBuckets(shape, day)) {
      for (const table of ['scan_node_returns', 'scan_placement_events']) {
        await d1(
          `UPDATE ${table} SET scan_bucket = ? WHERE id IN (
             SELECT id FROM ${table} WHERE event_id = ? AND scan_bucket NOT LIKE ? LIMIT ${Number.parseInt(n, 10)})`,
          [bucket, ev.id, `${day}T%`],
        );
      }
    }
    out.push({ station: st.id, eventId: ev.id, title: st.event.title, date: day, scansSent: sent, rowsStored: rows, shape: st.event.demo, placements: placements.map((p) => p.label) });
    console.log(`${st.id}: ${sent}/${total} scans, ${rows} rows`);
  }

  // Nightly roll-up (scan_aggregates), as the 03:00 cron would run it.
  const cron = await fetch(`${EXPLORER}/local/scheduled?worker=oursharedevents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cron: '0 3 * * *' }),
  });
  console.log(`roll-up: ${cron.status}`);
  if (!cron.ok) throw new Error(`roll-up failed: ${cron.status}`);
  await sleep(1500);

  for (const r of out) {
    const minted = await api('POST', `/api/v2/admin/events/${r.eventId}/shared-report/mint-link`, { role: 'admin', ttl_days: 30, depth: 'premium' });
    if (typeof minted.token !== 'string' || !minted.token) throw new Error(`contract: mint-link returned no token for ${r.station}`);
    r.reportPath = `/sharedReport?eventId=${encodeURIComponent(r.eventId)}&token=${encodeURIComponent(minted.token)}`;
    const check = await fetch(`${BASE}/api/v2/events/${r.eventId}/shared-report`, { headers: { Authorization: `Bearer ${minted.token}` } });
    const body = await check.json().catch(() => ({}));
    r.reportStatus = check.status;
    const n = body?.report?.distinct_scanners ?? body?.distinct_scanners;
    if (check.ok && !(typeof n === 'number' || n === null)) throw new Error(`contract: shared-report has no distinct_scanners for ${r.station}`);
    r.distinctScanners = n ?? null;
    console.log(`${r.station}: report ${check.status}, distinct_scanners=${JSON.stringify(r.distinctScanners)}`);
  }

  const dir = join(SHOWCASE, 'work', creator.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reports.json'), JSON.stringify({ base: BASE, seededAt: new Date().toISOString(), reports: out }, null, 2));
  console.log(`wrote ${join('showcase', 'work', creator.slug, 'reports.json')} (private)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
