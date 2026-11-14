// Seed a LOCAL OurSharedEvents worker from one creator file: one event per
// station that has an `event`, real poster placements, real scans through
// /q/<token> spread over the event's hours, the nightly roll-up, and a signed
// SharedReport link per event.
//
//   node showcase/seed-local.mjs <creator.json> [--plan <ose-events.json>]
//
// With --plan (the fixture's fixtures/sample-ose-events.json), it also creates
// the upcoming OSE events the creator links, on the creator's brand: their 5W
// text, poster codes, sponsors and one showcase placement per station event
// ("Showcase: <Station> page"), and writes showcase/work/<slug>/creator.json, the creator
// file with the plan's placeholder ids swapped for the real ones. A real
// creator's events are made by the owner in OSE admin, never by this script.
//
// The worker comes from start-local-ose.(ps1|sh), which writes
// showcase/local-ose.env.json (a throwaway key for that run; never committed).
// OSE_BASE and OSE_ADMIN_KEY in the environment win over the file.
// Refuses any base that is not 127.0.0.1 / localhost.
// Writes showcase/work/<slug>/reports.json: PRIVATE, it holds signed links.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertLocalBase, createPacer, hourBuckets, placementsFor, scansFor, SHAPES } from './lib/showcase.mjs';
import { SHOWCASE, readJson, loadCatalog } from './lib/build.mjs';
import { creatorProblems } from './lib/schema.mjs';
import { planDate } from './lib/plan.mjs';

const argv = process.argv.slice(2);
const planFlag = argv.indexOf('--plan');
const planPath = planFlag >= 0 ? argv[planFlag + 1] : null;
const creator = readJson(resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--plan') ?? ''));
const plan = planPath ? readJson(resolve(planPath)) : null;
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
  'poster_deployments', 'sponsor_business', 'campaigns'];
// event_series points at its anchor event, and events point at their series, so
// the links are cleared before either table is emptied.

/**
 * The plan's upcoming events, on the creator's brand (or the plan entry's own,
 * for the brand-isolation case), then the resolved creator file.
 */
async function seedPlan(pickType) {
  const catalog = loadCatalog().categories;
  const ids = {};
  const businesses = {};

  /**
   * The plan's sponsors for one event. The organizer adds each through the
   * admin API, which is the organizer's yes. The sponsor's own yes is given
   * from its sponsor home, which a script holds no token for, so on this
   * throwaway local database each side's answer is written as the plan gives
   * it: OSE's public bundle then decides what shows, as it does anywhere.
   */
  async function seedSponsors(p, eventId, brand) {
    await api('PUT', `/api/v2/admin/events/${eventId}`, { settings: { useSponsors: true } });
    for (const sp of p.sponsors) {
      let placement;
      if (!businesses[sp.id]) {
        const made = await api('POST', '/api/v2/admin/sponsors', { event_id: eventId, name: sp.name, brand_id: brand, tier: 'bronze' });
        if (typeof made.id !== 'string' || typeof made.placement_id !== 'string') throw new Error(`contract: sponsors returned no id for ${sp.id}`);
        businesses[sp.id] = made.id;
        placement = made.placement_id;
      } else {
        // The same business on a second event: one more placement, as the organizer's.
        placement = `spl_showcase_${Object.keys(ids).length}_${sp.id}`;
        await d1("INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active) VALUES (?, ?, ?, 'bronze', 'organizer', 1)", [placement, businesses[sp.id], eventId]);
      }
      // A sponsor that has not answered stays unset (pending), which is not a yes.
      if (sp.sponsorAccepted !== false) await d1('UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE id = ?', [placement]);
      await d1(`UPDATE sponsor_placement SET organizer_accepted = ${sp.organizerAccepted === false ? 0 : 1} WHERE id = ?`, [placement]);
      if (sp.campaign) {
        // An organizer makes the campaign and puts the placement in it (OSE S14).
        // OSE names the campaign; the creator file's link is swapped to that id below.
        if (!ids[sp.campaign.id]) {
          const made = await api('POST', '/api/v2/admin/campaigns', { title: sp.campaign.title, brand_id: brand });
          if (typeof made.id !== 'string') throw new Error(`contract: campaigns returned no id for ${sp.campaign.id}`);
          ids[sp.campaign.id] = made.id;
        }
        await api('PUT', `/api/v2/admin/campaigns/${ids[sp.campaign.id]}/placements/${placement}`);
      }
    }
  }

  for (const p of plan.events) {
    const link = (creator.events ?? []).find((e) => e.oseEventId === p.ref);
    if (!link) throw new Error(`plan: ${p.ref} is not linked in the creator file`);
    const station = creator.stations.find((s) => s.id === link.frequency);
    const cat = catalog.find((k) => k.id === (station.category ?? station.id));
    const day = planDate(p.on, Date.now(), p.timezone);
    const ev = await api('POST', '/api/v2/admin/events', {
      title: p.title,
      brand_id: p.brand ?? creator.oseBrand,
      start_date: day,
      end_date: day,
      timezone: p.timezone,
      is_published: true,
      ...(p.where_address ? { location: p.where_address, where_address: p.where_address } : {}),
      // An admin gives a place as coordinates; OSE keeps them to derive the event's area (its H3 cells).
      ...(Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: p.lat, lon: p.lon } : {}),
      ...Object.fromEntries(['what_short', 'who_host', 'why_purpose', 'how_details'].filter((k) => p[k]).map((k) => [k, p[k]])),
    });
    await api('PUT', `/api/v2/admin/events/${ev.id}`, { status: 'ready', start_time: p.time, event_type_id: pickType(cat?.eventKinds[0] ?? 'class') });
    if (p.codes) await api('PUT', `/api/v2/admin/events/${ev.id}/poster-codes`, { codes: p.codes });
    if (p.state !== 'draft') await api('PUT', `/api/v2/admin/events/${ev.id}`, { status: 'active' });
    ids[p.ref] = ev.id;
    if (p.sponsors) await seedSponsors(p, ev.id, p.brand ?? creator.oseBrand);
    if (p.placementRef) {
      const pd = await api('POST', `/api/v2/admin/events/${ev.id}/poster-deployments`, {
        placement_label: `Showcase: ${station.name ?? cat?.name ?? station.id} page`,
        placement_type: 'community',
      });
      if (typeof pd.id !== 'string') throw new Error(`contract: poster-deployments returned no id for ${p.ref}`);
      ids[p.placementRef] = pd.id;
    }
    console.log(`plan ${p.ref}: ${ev.id} on ${p.brand ?? creator.oseBrand}, ${day} ${p.time}${p.state === 'draft' ? ' (draft)' : ''}`);
  }
  // The plan's series, declared the way an organizer declares one: anchored on
  // its first event, with the others joining it (OSE ADR-029).
  for (const s of plan.series ?? []) {
    const [anchor, ...rest] = s.events.map((ref) => ids[ref]);
    if (!anchor || rest.some((id) => !id)) throw new Error(`plan: series ${s.ref} names an event the plan does not create`);
    await api('POST', `/api/v2/admin/events/${anchor}/series`, {
      name: s.name,
      cadence: s.cadence,
      ...(s.day_of_week !== undefined ? { day_of_week: s.day_of_week } : {}),
      ...(s.hour_of_day !== undefined ? { hour_of_day: s.hour_of_day } : {}),
      event_ids: rest,
    });
    console.log(`plan ${s.ref}: declared on ${anchor} with ${rest.length} more`);
  }
  const swap = (v) => ids[v] ?? v;
  const resolved = {
    ...creator,
    events: (creator.events ?? []).map((e) => ({ ...e, oseEventId: swap(e.oseEventId), ...(e.placement ? { placement: swap(e.placement) } : {}) })),
    ...(creator.campaigns ? { campaigns: creator.campaigns.map((c) => ({ ...c, oseCampaignId: swap(c.oseCampaignId) })) } : {}),
    ...(creator.schedule ? { schedule: { ...creator.schedule, rows: creator.schedule.rows.map((r) => (r.length === 5 ? [...r.slice(0, 4), swap(r[4])] : r)) } } : {}),
  };
  const dir = join(SHOWCASE, 'work', creator.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'creator.json'), JSON.stringify(resolved, null, 2));
  console.log(`wrote ${join('showcase', 'work', creator.slug, 'creator.json')} (the creator file with this run's OSE ids)`);
}

async function main() {
  for (const t of RESET_TABLES) await d1(`DELETE FROM ${t}`);
  await d1('UPDATE events SET series_id = NULL');
  await d1('DELETE FROM event_series');
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
    for (const label of placementsFor(st.event)) {
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

  if (plan) await seedPlan(pickType);

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
