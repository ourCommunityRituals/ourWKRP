// A stand-in for OSE's public API, built from the fixture's seed plan, so the
// read, render and gate layers are tested without a worker. It answers the
// public reads the build makes, in OSE's own response shapes (see
// handlers/events.ts, handlers/poster-bundle.ts and handlers/sponsors.ts at the
// .ose-ref commit). One of them is ahead of that commit, as OSE's open work
// defines it: a sponsor's `campaign: { id, title }` in the sponsor bundle. The
// brand calendar feed at /brands/<brand>/calendar.ics is served at that commit.
// The integration layer runs the same build against a real local worker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDate, zonedInstant } from '../lib/plan.mjs';

const SHOWCASE = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FAKE_ORIGIN = 'http://127.0.0.1:8917';
/** A fixed Monday, so every test reads the same programme. */
export const NOW = Date.parse('2026-11-16T15:00:00Z');

export const plan = () => JSON.parse(readFileSync(join(SHOWCASE, 'fixtures', 'sample-ose-events.json'), 'utf8'));

const WORDS = { public: 'EVENT', website: 'MORE', checkin: 'CHECK IN', register: 'REGISTER', tickets: 'TICKETS', sponsor: 'SPONSOR', signup: 'SIGN UP' };
const PREFIX = { public: 'Ev', website: 'Wb', checkin: 'Ck', register: 'Rg', tickets: 'Tk', sponsor: 'Sp', signup: 'Su' };
const num = (ref) => ref.replace(/\D/g, '').padStart(4, '0');

/** The public projection of one plan event, as OSE would serve it. */
export function planItem(ev, { brand, now }) {
  const day = planDate(ev.on, now, ev.timezone);
  return {
    id: ev.ref,
    brand_id: ev.brand ?? brand,
    title: ev.title,
    name: ev.title,
    status: ev.state === 'draft' ? 'draft' : 'active',
    start_date: day,
    end_date: day,
    timezone: ev.timezone,
    starts_at: ev.time ? zonedInstant(day, ev.time, ev.timezone) : null,
    what_short: ev.what_short ?? null,
    who_host: ev.who_host ?? null,
    why_purpose: ev.why_purpose ?? null,
    how_details: ev.how_details ?? null,
    where_address: ev.where_address ?? null,
    location: ev.where_address ?? null,
    venue: ev.where_address ?? null,
  };
}

/**
 * One sponsor row of the public bundle. Like OSE, it carries more than a page
 * may show: tokens, a website and a tier, which the build must leave behind.
 */
const sponsorRow = (sp, eventId) => ({
  id: sp.id,
  event_id: eventId,
  name: sp.name,
  title: sp.name,
  logo_url: `/api/v2/sponsors/${sp.id}/logo`,
  website_url: `https://partner.example.org/${sp.id}`,
  card_url: `/sponsors/${sp.id}`,
  tier: 'gold',
  click_token: `ct_${sp.id}`,
  display_token: `dt_${sp.id}`,
  beacon_token: `bt_${sp.id}`,
  is_active: 1,
  ...(sp.campaign ? { campaign: { id: sp.campaign.id, title: sp.campaign.title } } : {}),
});

/** Both sides said yes: the stand-in for OSE's SPONSOR_ON_SHOW_SQL. */
const onShow = (sp) => sp.sponsorAccepted !== false && sp.organizerAccepted !== false;

/**
 * A fetch that answers like OSE. `edit(kind, body)` may change a response
 * before it is sent, and `fail(kind, id)` may return a status to answer with
 * instead, for tests that plant a fault in what OSE returns.
 */
export function fakeOse({ brand = 'showcase-sample', now = NOW, origin = FAKE_ORIGIN, calls = [], edit = (_k, b) => b, fail = () => null, events = plan().events } = {}) {
  const items = events.map((ev) => [ev, planItem(ev, { brand, now })]);
  const json = (status, body) => new globalThis.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    if (u.origin !== origin) throw new Error(`fake OSE: unexpected origin ${u.origin}`);
    if (u.pathname === '/api/v2/events') {
      const b = u.searchParams.get('brand') || 'root';
      return json(200, edit('list', { ok: true, status: 200, items: items.filter(([, i]) => i.brand_id === b && i.status === 'active').map(([, i]) => i), sponsor_titles: {} }));
    }
    const feed = u.pathname.match(/^\/brands\/([^/]+)\/calendar\.ics$/);
    if (feed) {
      const b = decodeURIComponent(feed[1]);
      const shown = items.filter(([, i]) => i.brand_id === b && i.status === 'active').map(([, i]) => i);
      const failed = fail('calendar', b);
      if (failed || !shown.length) return new globalThis.Response('Not found', { status: failed || 404 });
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...shown.flatMap((i, k) => ['BEGIN:VEVENT', `UID:event-${k + 1}@ose.example`, `SUMMARY:${i.title}`, `DTSTART;VALUE=DATE:${i.start_date.replaceAll('-', '')}`, 'END:VEVENT']), 'END:VCALENDAR', ''];
      return new globalThis.Response(edit('calendar', { text: lines.join('\r\n') }).text, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
    }
    const bundle = u.pathname.match(/^\/api\/v2\/events\/([^/]+)\/poster-bundle$/);
    const backing = u.pathname.match(/^\/api\/v2\/events\/([^/]+)\/sponsor-bundle$/);
    const one = u.pathname.match(/^\/api\/v2\/events\/([^/]+)$/);
    const id = decodeURIComponent((bundle ?? backing ?? one)?.[1] ?? '');
    const hit = items.find(([, i]) => i.id === id);
    if (!hit) return json(404, { ok: false, status: 404, error: 'Event not found' });
    const [ev, item] = hit;
    if (item.status !== 'active') return json(403, { ok: false, status: 403, code: 'NOT_RENDERABLE' });
    const failed = fail(bundle ? 'bundle' : backing ? 'sponsors' : 'event', id);
    if (failed) return json(failed, { ok: false, status: failed, error: 'planted failure' });
    if (one) return json(200, edit('event', { ok: true, status: 200, item }));
    if (backing) {
      const rows = (ev.sponsors ?? []).filter(onShow).map((sp) => sponsorRow(sp, id));
      return json(200, edit('sponsors', { ok: true, status: 200, bundle: { sponsors: rows, surface_sponsors: { posterTop: rows, tvTop: rows, tvSide: rows, mobileBanner: rows }, rotation_config: { sponsorSlots: Math.max(rows.length, 1), rotationMs: 5000 } } }, id));
    }
    const n = num(ev.ref);
    const dep = u.searchParams.get('deployment');
    const deployment = dep && dep === ev.placementRef ? { id: dep, token: `qrt_${n.padStart(16, '0')}` } : null;
    const links = {};
    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      links[type] = deployment ? `${origin}/q/${deployment.token}?type=${type}` : `${origin}/events/${id}/forms/${type}`;
    }
    const slots = [{ kind: 'public' }, ...(ev.codes ?? [])].map((c) => ({
      kind: c.kind,
      word: WORDS[c.kind] ?? c.kind.toUpperCase(),
      label: WORDS[c.kind] ?? c.kind,
      code: `${PREFIX[c.kind] ?? 'Xx'}${n}`,
      url: `${origin}/s/${PREFIX[c.kind] ?? 'Xx'}${n}`,
      qr: 'data:image/png;base64,AAAA',
    }));
    return json(200, edit('bundle', { ok: true, status: 200, eventId: id, event: item, eventStatus: 'active', deploymentId: deployment?.id ?? null, qr: {}, links, labels: {}, slots, sponsors: [] }));
  };
}
