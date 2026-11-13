// Render a creator showcase from data: the creator page (the dial) and one page
// per station (owner, 2026-11-12). Nothing creator-specific lives here.
// Colours come only from the @ocr/ui tokens in `theme` (showcase/theme.css,
// generated from the pinned hub package): this file holds no colour values.
//
// Each page answers the five Ws and How. Station-level Who, What and Why come
// from the creator file; event-level When, Where and How come from OSE, read
// at build time. Nothing is kept in both places.
import { esc, fmtDate, floorText, mergeStations, safeHttpsUrl, FLOOR } from './showcase.mjs';
import { INTENT_LABELS, MODE_LABELS, isPast, slotOf, soonestFirst, stationSchedule, todayIn, whenText } from './schedule.mjs';
import { qrSvg } from './codes.mjs';

const isLeadStation = (s) => (s.category ?? s.id) === 'lead';

function css(stations) {
  return `
/* Layout: a radio dial. The creator page tunes to one page per station; each station page shows its programme, its events from OSE, their codes and its report. */
:root {
  --font-display: "Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  --step--1: 0.8125rem; --step-0: 1rem; --step-1: 1.25rem; --step-2: 1.75rem;
  --step-3: clamp(2rem, 5vw, 3rem); --step-4: clamp(3rem, 11vw, 7.5rem); --step-4s: clamp(2.25rem, 8vw, 4.5rem);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: var(--step-0); line-height: 1.6; }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
section { padding-block: clamp(48px, 8vw, 88px); border-top: 1px solid var(--border); }
h1, h2, h3 { font-family: var(--font-display); text-wrap: balance; margin: 0; line-height: 1.05; }
h2 { font-size: var(--step-3); font-weight: 800; letter-spacing: -0.01em; }
h3 { font-size: var(--step-1); font-weight: 700; }
p { margin: 0; max-width: 65ch; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-hover); }
:focus-visible { outline: 3px solid var(--focus-ring, var(--accent)); outline-offset: 3px; border-radius: 4px; }
.eyebrow { font-family: var(--font-mono); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.stack { display: flex; flex-direction: column; gap: 16px; }
.lede { font-size: var(--step-1); line-height: 1.5; }
.muted { color: var(--text-muted); }
.hero { padding-block: clamp(40px, 7vw, 80px) clamp(32px, 5vw, 56px); }
.onair { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: var(--step--1); letter-spacing: 0.14em; text-transform: uppercase; border: 1px solid var(--live); color: var(--live-text, var(--live)); padding: 6px 12px; border-radius: 999px; }
.onair i { width: 8px; height: 8px; border-radius: 50%; background: var(--live); display: block; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.25; } }
.hero h1 { font-size: var(--step-4); font-weight: 800; letter-spacing: -0.035em; margin-top: 20px; }
.hero h1 span { color: var(--accent); }
.station-hero h1 { font-size: var(--step-4s); }
.back { display: inline-flex; align-items: center; min-height: 44px; font-family: var(--font-mono); font-size: var(--step--1); }
.roles { display: flex; flex-wrap: wrap; gap: 8px 10px; margin-top: 24px; padding: 0; list-style: none; }
.roles li { font-family: var(--font-mono); font-size: var(--step--1); padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-muted); }
.hero .lede { margin-top: 28px; }
.tuner { margin-top: 40px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px clamp(12px, 3vw, 28px) 24px; }
.tuner-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.readout { font-family: var(--font-mono); font-size: var(--step-2); color: var(--accent); font-variant-numeric: tabular-nums; }
.readout small { font-size: var(--step--1); color: var(--text-muted); margin-left: 6px; }
.dial { display: block; width: 100%; min-width: 0; height: auto; margin-top: 12px; }
@media (max-width: 560px) { .dial .lbl { display: none; } }
.dial .tick { stroke: var(--border-strong); }
.dial .tick.major { stroke: var(--text-muted); }
.dial .lbl { fill: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.dial .needle { stroke: var(--live); stroke-width: 3; }
.dial .band { fill: var(--surface-hover); }
.dial .mark { fill: var(--accent); }
.channels { display: grid; grid-template-columns: repeat(${stations.length}, minmax(0, 1fr)); gap: 8px; margin-top: 16px; padding: 0; list-style: none; }
.ch { min-height: 56px; padding: 8px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: var(--font-display); font-weight: 700; font-size: var(--step-0); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-decoration: none; }
.ch .f { font-family: var(--font-mono); font-weight: 400; font-size: 0.75rem; color: var(--text-muted); }
.ch:hover { border-color: var(--border-strong); color: var(--text); }
.ch[aria-current="page"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ch[aria-current="page"] .f { color: var(--on-accent); }
@media (max-width: 720px) { .channels { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 20px; }
@media (max-width: 520px) { .sides { grid-template-columns: minmax(0, 1fr); } }
.side { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 0; }
.side .eyebrow { display: flex; align-items: center; gap: 8px; }
.side .dot { width: 8px; height: 8px; border-radius: 50%; display: block; }
.side.online .dot { background: var(--accent); }
.side.live .dot { background: var(--live); }
.side p { margin-top: 8px; font-size: 0.9375rem; }
.ledger { border-top: 1px solid var(--border); margin: 24px 0 0; }
.ledger > div { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); }
@media (max-width: 520px) { .ledger > div { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
.ledger dt { font-family: var(--font-mono); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); padding-top: 2px; }
.ledger dd { margin: 0; min-width: 0; }
.ledger ul { margin: 0; padding-left: 18px; }
.shot { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.shot a:has(img) { display: block; border: 1px solid var(--border-strong); border-radius: 14px; overflow: hidden; background: var(--surface-hover); }
.shot img { display: block; width: 100%; height: auto; max-width: 100%; }
.shot figcaption { font-size: var(--step--1); color: var(--text-muted); }
.station-report .shot { max-width: 760px; margin-top: 16px; }
.shot.compact img { aspect-ratio: 960 / 560; object-fit: cover; object-position: top; }
.shot picture { display: block; }
@media (max-width: 700px) {
  .station-report .shot img { height: auto; max-height: 120vh; object-fit: cover; object-position: top; }
  .shot.compact img { aspect-ratio: 3 / 4; }
}
.no-report { font-size: 0.9375rem; padding: 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); margin-top: 16px; }
.split { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: clamp(24px, 5vw, 64px); align-items: start; }
@media (max-width: 820px) { .split { grid-template-columns: minmax(0, 1fr); } }
.places { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }
.places li { font-family: var(--font-mono); font-size: var(--step--1); padding: 8px 12px; background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 6px; min-width: 0; overflow-wrap: anywhere; }
.places li a, .ledger li a, .event p a { display: inline-flex; align-items: center; min-height: 44px; }
.places li span { color: var(--text-muted); }
.bridge { list-style: none; padding: 0; margin: 32px 0 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); counter-reset: step; }
.bridge li { position: relative; padding: 0 16px 0 0; counter-increment: step; }
.bridge li::before { content: counter(step); display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; margin-bottom: 14px; font-family: var(--font-mono); font-size: var(--step--1); border: 1px solid var(--border-strong); background: var(--bg); position: relative; z-index: 1; }
.bridge li::after { content: ""; position: absolute; top: 18px; left: 36px; right: 0; border-top: 1px dashed var(--border-strong); }
.bridge li:last-child::after { display: none; }
.bridge li.on::before { border-color: var(--accent); color: var(--accent); }
.bridge li.live::before { border-color: var(--live); color: var(--live-text, var(--live)); }
.bridge h3 { font-size: var(--step-0); }
.bridge p { font-size: 0.9375rem; color: var(--text-muted); margin-top: 6px; }
.bridge .tag { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; display: block; margin-bottom: 4px; }
.bridge li.on .tag { color: var(--accent); }
.bridge li.live .tag { color: var(--live-text, var(--live)); }
@media (max-width: 860px) {
  .bridge { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .bridge li { padding: 0 0 0 52px; }
  .bridge li::before { position: absolute; left: 0; top: 0; margin: 0; }
  .bridge li::after { top: 36px; bottom: -20px; left: 18px; right: auto; border-top: 0; border-left: 1px dashed var(--border-strong); }
}
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 20px; margin-top: 32px; }
.demo-note { margin-top: 16px; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 0.9375rem; color: var(--text-muted); }
.demo-note b { color: var(--text); font-weight: 600; }
.rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 32px; border-top: 1px solid var(--border-strong); }
@media (max-width: 820px) { .rules { grid-template-columns: minmax(0, 1fr); } }
.rule { padding: 20px 20px 20px 0; min-width: 0; }
.rule + .rule { border-left: 1px solid var(--border); padding-left: 20px; }
@media (max-width: 820px) { .rule + .rule { border-left: 0; padding-left: 0; border-top: 1px solid var(--border); } }
.rule p { margin-top: 8px; color: var(--text-muted); }
.table-scroll { margin-top: 24px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 560px; }
th, td { text-align: left; padding: 12px 12px 12px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-family: var(--font-mono); font-weight: 400; font-size: var(--step--1); letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); }
td.d, td.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
td.num { text-align: right; }
td.num.w { color: var(--text-muted); }
.onair-list { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; }
.onair-list li { padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--live); border-radius: var(--radius-sm); }
.onair-list .next { display: block; margin-top: 4px; color: var(--text-muted); font-size: 0.9375rem; }
.events { display: grid; gap: 16px; margin-top: 16px; }
.event { padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); min-width: 0; }
.event .tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 8px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-muted); }
.tag.intent { color: var(--text); border-color: var(--accent); }
.event h3 { margin-top: 10px; }
.event p { margin-top: 6px; overflow-wrap: anywhere; }
.event .label { font-family: var(--font-mono); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-right: 6px; }
.codes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr)); gap: 16px; margin-top: 16px; }
.code { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.qr { display: block; width: 100%; max-width: 200px; height: auto; border-radius: 6px; }
.qr-paper { fill: var(--ocr-light-050); }
.qr-ink { fill: var(--ocr-ink-black); }
.code figcaption { font-size: var(--step--1); min-width: 0; }
.code .word { display: block; font-family: var(--font-mono); letter-spacing: 0.12em; color: var(--text-muted); }
.code a { display: inline-flex; align-items: center; min-height: 44px; font-family: var(--font-mono); overflow-wrap: anywhere; word-break: break-all; }
.empty { padding: 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); margin-top: 16px; }
.copied-note { margin-top: 12px; font-size: 0.9375rem; color: var(--text-muted); }
footer { border-top: 1px solid var(--border); padding-block: 36px 56px; font-size: 0.875rem; color: var(--text-muted); }
footer ul { padding-left: 18px; margin: 10px 0 0; }
footer .note { margin-top: 18px; }
@media (prefers-reduced-motion: reduce) { .onair i { animation: none; } }
`;
}

function head(title, theme, stations) {
  return `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${theme}
</style>
<style>${css(stations)}</style>
`;
}

// The dial, drawn once on the server: no script draws it.
const X0 = 20;
const X1 = 680;
const xOf = (f) => X0 + ((f - 88) / 20) * (X1 - X0);
function dialSvg(stations, current) {
  let ticks = '';
  let labels = '';
  for (let i = 0; i <= 40; i++) {
    const f = 88 + i / 2;
    const major = i % 4 === 0;
    const x = xOf(f).toFixed(1);
    ticks += `<line class="tick${major ? ' major' : ''}" x1="${x}" x2="${x}" y1="${major ? 14 : 22}" y2="46"></line>`;
    if (major) labels += `<text class="lbl" x="${x}" y="70" text-anchor="middle">${f}</text>`;
  }
  const marks = stations.map((s) => `<circle class="mark" cx="${xOf(s.freq).toFixed(1)}" cy="8" r="3"></circle>`).join('');
  const needle = current ? `<line class="needle" x1="${xOf(current.freq).toFixed(1)}" x2="${xOf(current.freq).toFixed(1)}" y1="4" y2="56"></line>` : '';
  return `<svg class="dial" viewBox="0 0 700 78" role="img" aria-label="Tuning dial from 88 to 108 megahertz with ${stations.length} stations marked${current ? `, tuned to ${esc(current.freq.toFixed(1))}` : ''}">
          <rect class="band" x="10" y="8" width="680" height="44" rx="6"></rect>${ticks}${labels}${marks}${needle}
        </svg>`;
}

/** The tuner: navigation between the station pages. `prefix` leads from this page to the creator folder. */
function tuner(c, stations, current, prefix) {
  return `<nav class="tuner" aria-labelledby="tuner-title">
      <div class="tuner-head">
        <span class="eyebrow" id="tuner-title">Tune a frequency</span>
        ${current ? `<span class="readout">${current.freq.toFixed(1)}<small>MHz</small> <span class="muted" style="font-size:var(--step-0)">${esc(current.name)}</span></span>` : ''}
      </div>
      ${dialSvg(stations, current)}
      <ul class="channels" aria-label="${esc(c.name)}'s frequencies">
        ${stations.map((s) => `<li><a class="ch" href="${prefix}${esc(s.id)}/index.html"${current?.id === s.id ? ' aria-current="page"' : ''}><span>${esc(s.name)}</span><span class="f">${s.freq.toFixed(1)}</span></a></li>`).join('')}
      </ul>
    </nav>`;
}

/** A place: a v1 [label, note] pair, or a typed place whose link is exactly the URL the creator file gives. */
function placeItem(p) {
  if (Array.isArray(p)) return `<li>${esc(p[0])} <span>${esc(p[1])}</span></li>`;
  const note = esc(p.note ?? p.kind);
  if (p.url && safeHttpsUrl(p.url)) return `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.label)}</a> <span>${note}</span></li>`;
  return `<li>${esc(p.label)} <span>${note}</span></li>`;
}

function codeFigure(code) {
  return `<figure class="code" data-code-url="${esc(code.url)}">
              ${qrSvg(code.url)}
              <figcaption><span class="word">${esc(code.word)}</span><a href="${esc(code.url)}">${esc(code.url)}</a></figcaption>
            </figure>`;
}

function footer(c, built) {
  const sourceItem = (s) => {
    const href = safeHttpsUrl(s.url);
    const label = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label);
    return `<li>${label}: ${esc(s.usedFor)}</li>`;
  };
  return `<footer>
  <div class="wrap">
    <span class="eyebrow">Sources</span>
    <ul>${c.sources.map(sourceItem).join('')}</ul>
    <p class="note">${esc(c.disclaimer)} Facts come from the public pages above, read ${esc(fmtDate(c.readOn))}. Report pages come from a local run of OurSharedEvents with simulated visitors.${built ? ` Events, times and codes come from OurSharedEvents as of ${esc(built)}; rebuild to show newer ones.` : ''}</p>
  </div>
</footer>`;
}

/**
 * Every page of one creator's showcase, as { 'index.html': html, '<station>/index.html': html }.
 * `ose` is what lib/ose.mjs read at build time: `{ origin, linked: [{ link, event, codes }] }`.
 */
/** "a", "a or b", "a, b or c". */
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

/**
 * The kinds of event this instance runs, in station order: each station's demo
 * event, then its programme slots. A bar reads "game night"; nobody is told
 * about a class or a set they do not run.
 */
export function eventKinds(creator) {
  const kinds = creator.stations.flatMap((s) => [s.event?.kind, ...(s.programme ?? []).map((p) => p.kind)]);
  return [...new Set(kinds.filter(Boolean).map((k) => String(k).trim().toLowerCase()))];
}

export function renderPages({ creator: c, catalog, reports = { reports: [] }, theme, ose = { origin: null, linked: [] }, now = Date.now() }) {
  const stations = mergeStations(c, catalog, reports);
  const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
  const linked = ose.linked ?? [];
  const schedules = Object.fromEntries(stations.map((s) => [s.id, stationSchedule(s, linked, now, { isLead: isLeadStation(s) })]));
  const problems = Object.values(schedules).flatMap((x) => x.problems);
  if (problems.length) throw new Error(`schedule refused:\n  ${[...new Set(problems)].join('\n  ')}`);
  const built = linked.length ? fmtDate(todayIn(now)) : null;

  const pages = { 'index.html': creatorPage({ c, stations, linked, reports, theme, now, built, byId }) };
  for (const s of stations) pages[`${s.id}/index.html`] = stationPage({ c, s, stations, schedule: schedules[s.id], theme, built, byId });
  return pages;
}

/** The creator page alone (the dial). */
export function renderPage(args) {
  return renderPages(args)['index.html'];
}

function reportFigure(s, prefix, { compact = false } = {}) {
  const r = s.report;
  if (!r?.images) return `<p class="muted no-report">No demo event on this station; it reads the other stations' reports together.</p>`;
  return `<figure class="shot${compact ? ' compact' : ''}">
    <a href="${prefix}${esc(r.images.desktop)}" target="_blank" rel="noopener" aria-label="Open the full ${esc(s.name)} report">
      <picture>
        ${r.images.phone ? `<source media="(max-width: 700px)" srcset="${prefix}${esc(r.images.phone)}">` : ''}
        <img src="${prefix}${esc(r.images.card)}" alt="The OurSharedEvents report for ${esc(r.title)}: ${esc(floorText(r.distinctScanners))} distinct scanners, broken down by poster code" loading="lazy" width="960" height="950">
      </picture>
    </a>
    <figcaption><span class="mono">${esc(s.freq.toFixed(1))}</span> ${esc(r.title)} · <a href="${prefix}${esc(r.images.desktop)}" target="_blank" rel="noopener">full report</a></figcaption>
  </figure>`;
}

function creatorPage({ c, stations, linked, reports, theme, now, built, byId }) {
  const withReports = stations.filter((s) => s.report?.images);
  const kinds = eventKinds(c).length ? eventKinds(c) : ['event'];
  const seededOn = reports.seededAt ? fmtDate(String(reports.seededAt).slice(0, 10)) : null;
  const stationData = stations.map((s) => ({ id: s.id, name: s.name }));
  const next = linked
    .filter(({ event }) => !isPast(event, now))
    .sort(soonestFirst)
    .slice(0, 5);
  // S5: a schedule row that names an OSE event retires: OSE is its source now,
  // and the event shows on its station page while it is public and upcoming.
  const copiedRows = (c.schedule?.rows ?? []).filter((r) => r.length < 5);

  const totalRow = (s) => {
    const r = s.report;
    const n = r?.distinctScanners ?? null;
    return `<tr><td><span class="mono">${s.freq.toFixed(1)}</span> ${esc(s.name)}</td><td>${esc(r ? r.title : '—')}</td><td>${esc(r?.placements?.join(', ') || '—')}</td><td class="num${n !== null && n < FLOOR ? ' w' : ''}">${r ? esc(floorText(n)) : '—'}</td></tr>`;
  };

  return `${head(`${c.name} on OurWKRP`, theme, stations)}
<div class="wrap">
  <header class="hero">
    <span class="onair"><i aria-hidden="true"></i>OurWKRP showcase</span>
    <h1>${esc(c.headline[0])} <span>${esc(c.headline[1])}</span></h1>
    <ul class="roles" aria-label="Roles">${c.roles.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="lede">${esc(c.lede)}</p>
    ${tuner(c, stations, null, '')}
  </header>

  <section aria-labelledby="w5-title">
    <span class="eyebrow">Five Ws and How</span>
    <h2 id="w5-title" style="margin-top:12px">${esc(c.name)}, at a glance.</h2>
    <dl class="ledger">
      <div><dt>Who</dt><dd>${esc(c.name)}: ${esc(c.roles.join(', '))}.</dd></div>
      <div><dt>What</dt><dd><ul>${stations.map((s) => `<li><a href="${esc(s.id)}/index.html">${esc(s.name)} ${s.freq.toFixed(1)}</a>: ${esc(s.title)}</li>`).join('')}</ul></dd></div>
      <div><dt>When</dt><dd>${
        next.length
          ? `<ul>${next.map(({ link, event }) => `<li>${esc(whenText(event, link))}: ${esc(event.title)} (<a href="${esc(link.frequency)}/index.html">${esc(byId[link.frequency]?.name ?? link.frequency)}</a>, ${esc(INTENT_LABELS[link.intent])})</li>`).join('')}</ul>`
          : 'Nothing is scheduled yet.'
      }</dd></div>
      <div><dt>Where</dt><dd>Online at the places under "Where the work lives"; in person at each event's own address, on its station page.</dd></div>
      <div><dt>Why</dt><dd>${esc(c.values.title)}</dd></div>
      <div><dt>How</dt><dd>Tune a frequency above. Each station page has its events, with a code to scan and the same link to tap.</dd></div>
    </dl>
  </section>

  <section aria-labelledby="scatter-title" id="places">
    <div class="split">
      <div class="stack">
        <span class="eyebrow">Where the work lives</span>
        <h2 id="scatter-title">A dozen stations, no shared dial.</h2>
        <p>${esc(c.name)}'s work already reaches people in many places. Each place keeps its own count, in its own format, on its own schedule. None of them can see the moment a viewer of a clip becomes someone in the live room.</p>
        <p class="muted">That gap between online attention and live participation is what OurWKRP closes. These links are plain links: the page counts nothing on them.</p>
      </div>
      <ul class="places" aria-label="Where the work lives today">${c.places.map(placeItem).join('')}</ul>
    </div>
  </section>

  <section aria-labelledby="bridge-title">
    <span class="eyebrow">The bridge</span>
    <h2 id="bridge-title" style="margin-top:12px">From a clip to a room to a report.</h2>
    <p style="margin-top:16px">The same path works for every station. One link carries the moment from the online side to the live side and back.</p>
    <ol class="bridge">
      <li class="on"><span class="tag">Online</span><h3>A clip goes out</h3><p>A post points at one OurWKRP link for this week's ${esc(orList(kinds))}.</p></li>
      <li class="on"><span class="tag">Online</span><h3>The link knows the moment</h3><p>The page shows what is on the air now: what it is, when, and how to get in.</p></li>
      <li class="live"><span class="tag">Live</span><h3>People show up</h3><p>A poster QR at the door, on screen or on a table counts the arrival, never the person.</p></li>
      <li class="live"><span class="tag">Live</span><h3>The room branches out</h3><p>From the same room: the game on screen, the music on the speakers, the research behind the talk, the merch on the table.</p></li>
      <li class="on"><span class="tag">After</span><h3>One report per moment</h3><p>Counts, floored under five. Each sponsor sees what they backed. ${esc(c.name)} sees all of it.</p></li>
    </ol>
  </section>

  <section aria-labelledby="reports-title">
    <div class="split">
      <div class="stack">
        <span class="eyebrow">Reporting</span>
        <h2 id="reports-title">${esc(c.values.title)}</h2>
        <p>${esc(c.values.body)}</p>
        <p class="demo-note"><b>These are real OurSharedEvents report pages.</b> Each event was created and scanned through the product's own poster codes on a private local run${seededOn ? ` on ${esc(seededOn)}` : ''}. Events are dated in the recent past so each report is complete, and the visitors are simulated, so the numbers show what a report looks like, not real attendance. Where an hour had fewer than five visitors, the report withheld it, which is why some totals are lower than the scans sent.</p>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="People per station">
        <table>
          <thead><tr><th scope="col">Station</th><th scope="col">Event</th><th scope="col">Where the codes hung</th><th scope="col" style="text-align:right">People</th></tr></thead>
          <tbody>${stations.map(totalRow).join('')}</tbody>
        </table>
      </div>
    </div>
    ${withReports.length ? `<div class="gallery">${withReports.map((s) => reportFigure(s, '', { compact: true })).join('')}</div>` : ''}
  </section>

  <section aria-labelledby="choice-title">
    <span class="eyebrow">Sponsorship with true choice</span>
    <h2 id="choice-title" style="margin-top:12px">${esc(c.sponsorship.title)}</h2>
    <p style="margin-top:16px">${esc(c.sponsorship.body)}</p>
    <div class="rules">
      <div class="rule"><h3>Both sides say yes</h3><p>A sponsor appears only when it has accepted and ${esc(c.name)} has accepted. Either side can withdraw.</p></div>
      <div class="rule"><h3>${esc(c.name)} picks the placement</h3><p>Which ${esc(orList(kinds))} carries which sponsor is ${esc(c.name)}'s call. A sponsor never becomes a filter on who can attend.</p></div>
      <div class="rule"><h3>Sponsors get the report</h3><p>They see the counts for what they backed, floored under five. They never get a list of people.</p></div>
    </div>
  </section>

  ${
    c.schedule && copiedRows.length
      ? `<section aria-labelledby="now-title">
    <span class="eyebrow">Copied schedule</span>
    <h2 id="now-title" style="margin-top:12px">Ready-made first broadcasts.</h2>
    <p style="margin-top:16px">${esc(c.schedule.intro)} Dates and prices as listed on ${esc(c.schedule.source)}, read ${esc(fmtDate(c.readOn))}.</p>
    <p class="copied-note">Copied from ${esc(c.schedule.source)}. These are not OurSharedEvents events yet; once one is, it moves to its station page and leaves this table.</p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Copied schedule">
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Price</th><th scope="col">Natural pairing</th></tr></thead>
        <tbody>${copiedRows.map(([d, t, p, n]) => `<tr><td class="d">${esc(fmtDate(d))}</td><td>${esc(t)}</td><td class="mono">${esc(p)}</td><td>${esc(n)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`
      : ''
  }
</div>

${footer(c, built)}

<script>
(function () {
  // A station link from before station pages (#teach) opens that station's page.
  var CH = ${JSON.stringify(stationData).replace(/</g, '\\u003c')};
  var h = (location.hash || "").slice(1);
  for (var i = 0; i < CH.length; i++) if (CH[i].id === h) { location.replace(CH[i].id + "/index.html"); return; }
})();
</script>
`;
}

function eventCard({ link, event, codes }, i, { isLead, byId }) {
  // Every programme event on a slot carries that slot's purpose, not only the next one.
  const slot = byId[link.frequency] ? slotOf(byId[link.frequency], link, event) : null;
  const why = event.whyPurpose || slot?.purpose || byId[link.frequency]?.why || null;
  const mode = event.attendanceMode ? MODE_LABELS[event.attendanceMode] : null;
  const where = event.attendanceMode === 'online' ? 'Online' : event.whereAddress || event.venue;
  const row = (label, value) => (value ? `<p><span class="label">${label}</span>${esc(value)}</p>` : '');
  return `<article class="event" aria-labelledby="ev-${i}">
          <p class="tags"><span class="tag intent">${esc(INTENT_LABELS[link.intent])}</span>${mode ? `<span class="tag">${esc(mode)}</span>` : ''}${isLead ? `<span class="tag">${esc(byId[link.frequency]?.name ?? link.frequency)}</span>` : ''}</p>
          <h3 id="ev-${i}">${esc(event.title)}</h3>
          ${row('When', whenText(event, link))}
          ${row('Where', where)}
          ${row('What', event.whatShort)}
          ${row('Host', event.whoHost)}
          ${row('Why', why)}
          ${row('How', event.howDetails)}
          ${
            isLead
              ? `<p><a href="../${esc(link.frequency)}/index.html">Codes on the ${esc(byId[link.frequency]?.name ?? link.frequency)} page</a></p>`
              : codes.length
                ? `<div class="codes" aria-label="Codes for ${esc(event.title)}">${codes.map(codeFigure).join('')}</div>`
                : ''
          }
        </article>`;
}

function stationPage({ c, s, stations, schedule, theme, built, byId }) {
  const isLead = isLeadStation(s);
  const places = c.places.filter((p) => !Array.isArray(p) && p.station === s.id);
  const firstUp = schedule.upcoming[0];
  return `${head(`${s.name} ${s.freq.toFixed(1)}: ${c.name} on OurWKRP`, theme, stations)}
<div class="wrap">
  <header class="hero station-hero">
    <a class="back" href="../index.html">All of ${esc(c.name)}'s frequencies</a>
    <p class="eyebrow">${s.freq.toFixed(1)} · ${esc(s.name)} · ${esc(s.eyebrow)}</p>
    <h1>${esc(s.title)}</h1>
    <p class="lede">${esc(s.intro)}</p>
    ${tuner(c, stations, s, '../')}
  </header>

  <section aria-labelledby="w5-title">
    <span class="eyebrow">Five Ws and How</span>
    <h2 id="w5-title" style="margin-top:12px">On ${esc(s.name)}, ${s.freq.toFixed(1)}.</h2>
    <dl class="ledger">
      <div><dt>Who</dt><dd>${esc(c.name)}, ${esc(s.eyebrow)}.</dd></div>
      <div><dt>What</dt><dd>${esc(s.title)}.${s.covers ? ` Covers ${esc(s.covers)}.` : ''}</dd></div>
      <div><dt>When</dt><dd>${firstUp ? `Next: ${esc(whenText(firstUp.event, firstUp.link))}, ${esc(firstUp.event.title)}. The programme and every date are below.` : 'Nothing is scheduled on this frequency yet.'}</dd></div>
      <div><dt>Where</dt><dd>${esc(s.where)}${places.length ? `<ul class="places" aria-label="${esc(s.name)} places" style="margin-top:10px">${places.map(placeItem).join('')}</ul>` : ''}</dd></div>
      ${s.why ? `<div><dt>Why</dt><dd>${esc(s.why)}</dd></div>` : ''}
      <div><dt>How</dt><dd>${isLead ? 'Every frequency in one view; each event links to its own station page for its codes.' : 'Each event below has its codes: scan one on another screen, or tap its link.'}</dd></div>
    </dl>
    <div class="sides">
      <div class="side online"><span class="eyebrow"><span class="dot"></span>Online side</span><p>${esc(s.online)}</p></div>
      <div class="side live"><span class="eyebrow"><span class="dot"></span>Live side</span><p>${esc(s.live)}</p></div>
    </div>
  </section>

  <section aria-labelledby="when-title" id="when">
    <span class="eyebrow">When</span>
    <h2 id="when-title" style="margin-top:12px">${isLead ? 'Every frequency, soonest first.' : 'On air and coming up.'}</h2>
    ${
      schedule.onAir.length
        ? `<ul class="onair-list" aria-label="On air">${schedule.onAir
            .map((o) => `<li><b>On air</b> · ${esc(o.text)}<span class="next">${o.next ? `Next: ${esc(whenText(o.next.event, o.next.link))}` : 'Next date to be announced'}</span></li>`)
            .join('')}</ul>`
        : ''
    }
    ${
      schedule.upcoming.length
        ? `<div class="events">${schedule.upcoming.map((x, i) => eventCard(x, i, { isLead, byId })).join('')}</div>`
        : `<p class="empty">Nothing is scheduled on this frequency yet.</p>`
    }
  </section>

  <section aria-labelledby="report-title" class="station-report">
    <span class="eyebrow">The real report for this station</span>
    <h2 id="report-title" style="margin-top:12px">What a report shows.</h2>
    <dl class="ledger">
      <div><dt>OurWKRP tracks</dt><dd>${esc(s.track)}</dd></div>
      <div><dt>The report shows</dt><dd>${esc(s.reportCopy)}</dd></div>
      <div><dt>Sponsor fit</dt><dd>${esc(s.sponsor)}</dd></div>
      <div><dt>${esc(c.pronoun.possessive.charAt(0).toUpperCase() + c.pronoun.possessive.slice(1))} choice</dt><dd>${esc(s.choice)}</dd></div>
    </dl>
    ${s.report?.images ? '<p class="eyebrow" style="margin-top:16px">Demo visitors</p>' : ''}
    ${reportFigure(s, '../')}
  </section>
</div>

${footer(c, built)}
`;
}
