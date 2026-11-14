// Integration verdict on the OSE read (S3) and the codes (S4), after a seeded
// run against a real local worker:
//   node showcase/tests/integration/check-ose.mjs <slug>
// Expectations come from the seed plan, not from the renderer: each upcoming,
// public, on-brand event has one card on its station page and on Lead; a draft,
// another brand's and a past event have none; each card shows the placement's
// /q code (when it has a placement) and every non-form /s code; and every code
// on every page answers the live worker with a redirect that is not a form.
// Sponsors (S9): a card names exactly the plan's sponsors that both sides
// accepted; one side's yes, a pending answer and a past event's sponsor reach no
// page. A campaign partner is expected at the top of its station only when the
// worker's sponsor bundle carries campaigns (OSE S14).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalBase } from '../../lib/showcase.mjs';
import { SHOWCASE, readJson } from '../../lib/build.mjs';
import { FORM_KINDS } from '../../lib/codes.mjs';
import { planDate } from '../../lib/plan.mjs';

const FORM_TARGET = /\/forms?\//i;

/**
 * @param {object} plan         fixtures/sample-ose-events.json
 * @param {object} creator      the resolved creator file (real ids)
 * @param {Record<string,string>} pages  path → html of the built folder
 * @param {{url: string, status: number, location: string|null}[]} resolved  each code, fetched once
 * @param {number} now
 * @param {{campaigns?: boolean}} [worker]  whether the worker's sponsor bundle names campaigns
 */
export function oseVerdictProblems(plan, creator, pages, resolved, now, { campaigns = false } = {}) {
  const out = [];
  const onShow = (sp) => sp.sponsorAccepted !== false && sp.organizerAccepted !== false;
  const strips = (html) => (html.match(/<p class="backers">[\s\S]*?<\/p>/g) ?? []).map((p) => [...p.matchAll(/<span class="backer">([^<]*)<\/span>/g)].map((x) => x[1]).sort().join(' + '));
  const wantStrips = {};
  const wantPartners = {};
  const lead = creator.stations.find((s) => (s.category ?? s.id) === 'lead')?.id;
  const today = (tz) => planDate({ days: 0 }, now, tz);
  const cards = (html) => (html.match(/<article class="event"/g) ?? []).length;
  const codes = (html) => [...html.matchAll(/data-code-url="([^"]*)"/g)].map((x) => x[1]);
  const want = {};
  const wantCodes = {};
  // The seed writes the creator's links in the plan's order.
  if (plan.events.length !== creator.events.length) out.push(`${creator.events.length} links for ${plan.events.length} planned events`);
  plan.events.forEach((p, i) => {
    const link = creator.events[i];
    const shown = p.state !== 'draft' && !p.brand && planDate(p.on, now, p.timezone) >= today(p.timezone);
    const all = Object.values(pages).join('\n');
    if (!shown && p.title && all.includes(`>${p.title}<`) && !plan.events.some((q) => q !== p && q.title === p.title && q.state !== 'draft' && !q.brand)) {
      out.push(`${p.ref}: "${p.title}" reached a page`);
    }
    const backers = (p.sponsors ?? []).filter(onShow);
    for (const sp of p.sponsors ?? []) {
      // A name that shows nowhere else: not on show here, or on an event that is not shown.
      const elsewhere = plan.events.some((q) => q.state !== 'draft' && !q.brand && planDate(q.on, now, q.timezone) >= today(q.timezone) && (q.sponsors ?? []).some((x) => x.name === sp.name && onShow(x)));
      if (!elsewhere && all.includes(sp.name)) out.push(`${p.ref}: sponsor "${sp.name}" reached a page`);
    }
    if (!shown) return;
    if (backers.length) {
      const names = backers.map((b) => b.name).sort().join(' + ');
      for (const id of [link.frequency, ...(link.also ?? []), lead].filter(Boolean)) (wantStrips[id] ??= []).push(names);
      for (const b of backers) {
        if (campaigns && b.campaign) {
          // A campaign shows on its own station and any it also names, wherever one of this event's stations is among them.
          for (const c of (creator.campaigns ?? []).filter((k) => k.oseCampaignId === b.campaign.id)) {
            for (const id of [c.frequency, ...(c.also ?? [])]) if ([link.frequency, ...(link.also ?? [])].includes(id)) (wantPartners[id] ??= new Set()).add(b.name);
          }
        }
      }
    }
    // An event shows on the station it lives on and on any it also names; its codes stay at home.
    for (const id of [link.frequency, ...(link.also ?? [])]) want[id] = (want[id] ?? 0) + 1;
    if (lead) want[lead] = (want[lead] ?? 0) + 1;
    wantCodes[link.frequency] = (wantCodes[link.frequency] ?? 0) + (link.placement ? 1 : 0) + 1 + (p.codes ?? []).filter((c) => !FORM_KINDS.has(c.kind)).length;
  });
  for (const s of creator.stations) {
    const html = pages[`${s.id}/index.html`] ?? '';
    if (cards(html) !== (want[s.id] ?? 0)) out.push(`${s.id}: ${cards(html)} event cards, want ${want[s.id] ?? 0}`);
    if (codes(html).length !== (wantCodes[s.id] ?? 0)) out.push(`${s.id}: ${codes(html).length} codes, want ${wantCodes[s.id] ?? 0}`);
    const got = strips(html).sort().join(' | ');
    const wanted = (wantStrips[s.id] ?? []).sort().join(' | ');
    if (got !== wanted) out.push(`${s.id}: sponsor strips "${got}", want "${wanted}"`);
    const partners = [...(html.match(/<ul class="partners"[\s\S]*?<\/ul>/)?.[0] ?? '').matchAll(/<span class="backer">([^<]*)<\/span>/g)].map((x) => x[1]).sort().join(' + ');
    const wantedPartners = [...(wantPartners[s.id] ?? [])].sort().join(' + ');
    if (partners !== wantedPartners) out.push(`${s.id}: station partners "${partners}", want "${wantedPartners}"`);
  }
  const shownCodes = new Set(Object.values(pages).flatMap(codes));
  for (const url of shownCodes) {
    const r = resolved.find((x) => x.url === url);
    if (!r) out.push(`${url}: not resolved`);
    else if (r.status !== 302) out.push(`${url}: answered ${r.status}, want a 302`);
    // A /q scan lands on the event page; OSE adds ?type=register&deployment=…
    // there as the page's call-to-action hint. Only a form PATH is a form.
    else if (!r.location || FORM_TARGET.test(new URL(r.location).pathname)) out.push(`${url}: leads to ${r.location ?? 'nowhere'}, not to the event or its link`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const slug = process.argv[2];
  const creator = readJson(join(SHOWCASE, 'work', slug, 'creator.json'));
  const plan = readJson(join(SHOWCASE, 'fixtures', 'sample-ose-events.json'));
  const base = assertLocalBase(readJson(join(SHOWCASE, 'local-ose.env.json')).base);
  const outDir = join(SHOWCASE, 'out', slug);
  const pages = Object.fromEntries(['index.html', ...creator.stations.map((s) => `${s.id}/index.html`)].map((p) => [p, readFileSync(join(outDir, p), 'utf8')]));
  const urls = [...new Set(Object.values(pages).flatMap((h) => [...h.matchAll(/data-code-url="([^"]*)"/g)].map((x) => x[1])))];
  const resolved = [];
  for (const url of urls) {
    if (!url.startsWith(`${base}/`)) {
      resolved.push({ url, status: 0, location: null });
      continue;
    }
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'showcase-integration' } });
    resolved.push({ url, status: res.status, location: res.headers.get('location') });
  }
  // Does this worker's sponsor bundle name campaigns? Asked of the worker itself, not of the page.
  let campaigns = false;
  for (const e of creator.events) {
    const res = await fetch(`${base}/api/v2/events/${encodeURIComponent(e.oseEventId)}/sponsor-bundle?surface=public`);
    const body = res.ok ? await res.json().catch(() => null) : null;
    if ((body?.bundle?.sponsors ?? []).some((sp) => sp.campaign)) campaigns = true;
  }
  const problems = oseVerdictProblems(plan, creator, pages, resolved, Date.now(), { campaigns });
  console.log(`sponsor bundle names campaigns: ${campaigns ? 'yes' : 'no (this OSE is before campaigns in the bundle)'}`);
  for (const r of resolved) console.log(`${r.url} -> ${r.status} ${r.location ?? ''}`);
  if (problems.length) {
    console.error(`::error::showcase OSE integration failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`showcase OSE integration: ${urls.length} codes answered, every upcoming public event on its station page, nothing else`);
}
