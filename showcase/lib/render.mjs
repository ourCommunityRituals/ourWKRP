// Render a creator showcase page from data. Nothing creator-specific lives here.
// Colours come only from the @ocr/ui tokens in `theme` (showcase/theme.css,
// generated from the pinned hub package): this file holds no colour values.
import { esc, fmtDate, floorText, mergeStations, safeHttpsUrl, FLOOR } from './showcase.mjs';

export function renderPage({ creator: c, catalog, reports = { reports: [] }, theme }) {
  const stations = mergeStations(c, catalog, reports);
  const withReports = stations.filter((s) => s.report?.images);
  const seededOn = reports.seededAt ? fmtDate(String(reports.seededAt).slice(0, 10)) : null;
  const possessive = c.pronoun.possessive[0].toUpperCase() + c.pronoun.possessive.slice(1);

  function reportFigure(s, { compact = false } = {}) {
    const r = s.report;
    if (!r?.images) return `<p class="muted no-report">No event on this station; it reads the other stations' reports together.</p>`;
    return `<figure class="shot${compact ? ' compact' : ''}">
    <a href="${esc(r.images.desktop)}" target="_blank" rel="noopener" aria-label="Open the full ${esc(s.name)} report">
      <picture>
        ${r.images.phone ? `<source media="(max-width: 700px)" srcset="${esc(r.images.phone)}">` : ''}
        <img src="${esc(r.images.card)}" alt="The OurSharedEvents report for ${esc(r.title)}: ${esc(floorText(r.distinctScanners))} distinct scanners, broken down by poster code" loading="lazy" width="960" height="950">
      </picture>
    </a>
    <figcaption><span class="mono">${esc(s.freq.toFixed(1))}</span> ${esc(r.title)} · <a href="${esc(r.images.desktop)}" target="_blank" rel="noopener">full report</a></figcaption>
  </figure>`;
  }

  const totalRow = (s) => {
    const r = s.report;
    const n = r?.distinctScanners ?? null;
    return `<tr><td><span class="mono">${s.freq.toFixed(1)}</span> ${esc(s.name)}</td><td>${esc(r ? r.title : '—')}</td><td>${esc(r?.placements?.join(', ') || '—')}</td><td class="num${n !== null && n < FLOOR ? ' w' : ''}">${r ? esc(floorText(n)) : '—'}</td></tr>`;
  };

  const sourceItem = (s) => {
    const href = safeHttpsUrl(s.url);
    const label = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label);
    return `<li>${label}: ${esc(s.usedFor)}</li>`;
  };

  const stationData = stations.map((s) => ({ id: s.id, name: s.name, f: s.freq }));

  return `<title>${esc(c.name)} on OurWKRP</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${theme}
</style>
<style>
/* Layout: a radio tuner. One dial, one station per category the creator uses; each station shows its online and live sides and the real OSE report for its event. */
:root {
  --font-display: "Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  --step--1: 0.8125rem; --step-0: 1rem; --step-1: 1.25rem; --step-2: 1.75rem;
  --step-3: clamp(2rem, 5vw, 3rem); --step-4: clamp(3rem, 11vw, 7.5rem);
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
.roles { display: flex; flex-wrap: wrap; gap: 8px 10px; margin-top: 24px; padding: 0; list-style: none; }
.roles li { font-family: var(--font-mono); font-size: var(--step--1); padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-muted); }
.hero .lede { margin-top: 28px; }
.tuner { margin-top: 40px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px clamp(12px, 3vw, 28px) 24px; }
.tuner-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.readout { font-family: var(--font-mono); font-size: var(--step-2); color: var(--accent); font-variant-numeric: tabular-nums; }
.readout small { font-size: var(--step--1); color: var(--text-muted); margin-left: 6px; }
.dial-scroll { overflow-x: auto; margin-top: 12px; }
.dial { display: block; width: 100%; min-width: 0; height: auto; }
@media (max-width: 560px) { .dial .lbl { display: none; } }
.dial .tick { stroke: var(--border-strong); }
.dial .tick.major { stroke: var(--text-muted); }
.dial .lbl { fill: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.dial .needle { stroke: var(--live); stroke-width: 3; transition: transform 500ms cubic-bezier(.3,.7,.2,1); }
.dial .band { fill: var(--surface-hover); }
.channels { display: grid; grid-template-columns: repeat(${stations.length}, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
.ch { min-height: 56px; padding: 8px 6px; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: var(--font-display); font-weight: 700; font-size: var(--step-0); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.ch .f { font-family: var(--font-mono); font-weight: 400; font-size: 0.75rem; color: var(--text-muted); }
.ch:hover { border-color: var(--border-strong); }
.ch[aria-selected="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ch[aria-selected="true"] .f { color: var(--on-accent); }
@media (max-width: 720px) { .channels { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.panel { margin-top: 24px; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(20px, 3vw, 40px); }
.panel .shot-slot { grid-column: 1 / -1; }
@media (max-width: 820px) { .panel { grid-template-columns: minmax(0, 1fr); } }
.shot-head { max-width: 760px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.panel h3 { font-size: var(--step-2); margin-top: 8px; }
.panel .where { margin-top: 6px; }
.panel .intro { margin-top: 14px; }
.sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 20px; }
@media (max-width: 520px) { .sides { grid-template-columns: minmax(0, 1fr); } }
.side { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 0; }
.side .eyebrow { display: flex; align-items: center; gap: 8px; }
.side .dot { width: 8px; height: 8px; border-radius: 50%; display: block; }
.side.online .dot { background: var(--accent); }
.side.live .dot { background: var(--live); }
.side p { margin-top: 8px; font-size: 0.9375rem; }
.ledger { border-top: 1px solid var(--border); margin: 0; }
.ledger div { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); }
@media (max-width: 520px) { .ledger div { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
.ledger dt { font-family: var(--font-mono); font-size: var(--step--1); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); padding-top: 2px; }
.ledger dd { margin: 0; }
.shot { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.shot a:has(img) { display: block; border: 1px solid var(--border-strong); border-radius: 14px; overflow: hidden; background: var(--surface-hover); }
.shot img { display: block; width: 100%; height: auto; max-width: 100%; }
.shot figcaption { font-size: var(--step--1); color: var(--text-muted); }
.panel .shot { max-width: 760px; }
.shot.compact img { aspect-ratio: 960 / 560; object-fit: cover; object-position: top; }
.shot picture { display: block; }
/* On a phone the report is the phone capture: tall, so the station panel shows its top and links to the rest. */
@media (max-width: 700px) {
  .panel .shot img { height: auto; max-height: 120vh; object-fit: cover; object-position: top; }
  .shot.compact img { aspect-ratio: 3 / 4; }
}
.no-report { font-size: 0.9375rem; padding: 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); }
.split { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: clamp(24px, 5vw, 64px); align-items: start; }
@media (max-width: 820px) { .split { grid-template-columns: minmax(0, 1fr); } }
.places { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }
.places li { font-family: var(--font-mono); font-size: var(--step--1); padding: 8px 12px; background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 6px; }
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
footer { border-top: 1px solid var(--border); padding-block: 36px 56px; font-size: 0.875rem; color: var(--text-muted); }
footer ul { padding-left: 18px; margin: 10px 0 0; }
footer .note { margin-top: 18px; }
@media (prefers-reduced-motion: reduce) { .onair i { animation: none; } .dial .needle { transition: none; } }
</style>

<div class="wrap">
  <header class="hero">
    <span class="onair"><i aria-hidden="true"></i>OurWKRP showcase</span>
    <h1>${esc(c.headline[0])} <span>${esc(c.headline[1])}</span></h1>
    <ul class="roles" aria-label="Roles">${c.roles.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="lede">${esc(c.lede)}</p>

    <div class="tuner" aria-labelledby="tuner-title">
      <div class="tuner-head">
        <span class="eyebrow" id="tuner-title">Tune a frequency</span>
        <span class="readout" aria-live="polite"><span id="freq">${stations[0].freq.toFixed(1)}</span><small>MHz</small> <span id="freqname" class="muted" style="font-size:var(--step-0)">${esc(stations[0].name)}</span></span>
      </div>
      <div class="dial-scroll">
        <svg class="dial" viewBox="0 0 700 78" role="img" aria-label="Tuning dial from 88 to 108 megahertz with ${stations.length} stations marked">
          <rect class="band" x="10" y="8" width="680" height="44" rx="6"></rect>
          <g id="ticks"></g><g id="labels"></g>
          <line class="needle" id="needle" x1="0" y1="4" x2="0" y2="56"></line>
        </svg>
      </div>
      <div class="channels" role="tablist" aria-label="${esc(c.name)}'s frequencies">
        ${stations.map((s, i) => `<button type="button" class="ch" role="tab" id="tab-${esc(s.id)}" aria-controls="panel-${esc(s.id)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span>${esc(s.name)}</span><span class="f">${s.freq.toFixed(1)}</span></button>`).join('')}
      </div>
      ${stations
        .map(
          (s, i) => `
      <div class="panel" id="panel-${esc(s.id)}" role="tabpanel" aria-labelledby="tab-${esc(s.id)}" tabindex="0"${i === 0 ? '' : ' hidden'}>
        <div>
          <span class="eyebrow">${s.freq.toFixed(1)} · ${esc(s.eyebrow)}</span>
          <h3>${esc(s.title)}</h3>
          <p class="where muted">${esc(s.where)}</p>
          <p class="intro">${esc(s.intro)}</p>
          <div class="sides">
            <div class="side online"><span class="eyebrow"><span class="dot"></span>Online side</span><p>${esc(s.online)}</p></div>
            <div class="side live"><span class="eyebrow"><span class="dot"></span>Live side</span><p>${esc(s.live)}</p></div>
          </div>
        </div>
        <dl class="ledger">
          <div><dt>OurWKRP tracks</dt><dd>${esc(s.track)}</dd></div>
          <div><dt>The report shows</dt><dd>${esc(s.reportCopy)}</dd></div>
          <div><dt>Sponsor fit</dt><dd>${esc(s.sponsor)}</dd></div>
          <div><dt>${esc(possessive)} choice</dt><dd>${esc(s.choice)}</dd></div>
        </dl>
        <div class="shot-slot">
          <div class="shot-head"><span class="eyebrow">The real report for this station</span>${s.report?.images ? `<span class="eyebrow">Demo visitors</span>` : ''}</div>
          ${reportFigure(s)}
        </div>
      </div>`,
        )
        .join('')}
    </div>
  </header>

  <section aria-labelledby="scatter-title">
    <div class="split">
      <div class="stack">
        <span class="eyebrow">Today</span>
        <h2 id="scatter-title">A dozen stations, no shared dial.</h2>
        <p>${esc(c.name)}'s work already reaches people in many places. Each place keeps its own count, in its own format, on its own schedule. None of them can see the moment a viewer of a clip becomes someone in the live room.</p>
        <p class="muted">That gap between online attention and live participation is what OurWKRP closes.</p>
      </div>
      <ul class="places" aria-label="Where the work lives today">${c.places.map(([a, b]) => `<li>${esc(a)} <span>${esc(b)}</span></li>`).join('')}</ul>
    </div>
  </section>

  <section aria-labelledby="bridge-title">
    <span class="eyebrow">The bridge</span>
    <h2 id="bridge-title" style="margin-top:12px">From a clip to a room to a report.</h2>
    <p style="margin-top:16px">The same path works for every station. One link carries the moment from the online side to the live side and back.</p>
    <ol class="bridge">
      <li class="on"><span class="tag">Online</span><h3>A clip goes out</h3><p>A post points at one OurWKRP link for this week's class, set or game night.</p></li>
      <li class="on"><span class="tag">Online</span><h3>The link knows the moment</h3><p>The page shows what is on the air now: what it is, when, and how to get in.</p></li>
      <li class="live"><span class="tag">Live</span><h3>People show up</h3><p>A poster QR at the door, on screen or on a table counts the arrival, never the person.</p></li>
      <li class="live"><span class="tag">Live</span><h3>The room branches out</h3><p>From the same room: the game on screen, the music on the speakers, the research behind the talk, the merch on the table.</p></li>
      <li class="on"><span class="tag">After</span><h3>One report per moment</h3><p>Counts, floored under five. Each sponsor sees what they backed. The creator sees all of it.</p></li>
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
      <div class="table-scroll">
        <table>
          <thead><tr><th scope="col">Station</th><th scope="col">Event</th><th scope="col">Where the codes hung</th><th scope="col" style="text-align:right">People</th></tr></thead>
          <tbody>${stations.map(totalRow).join('')}</tbody>
        </table>
      </div>
    </div>
    ${withReports.length ? `<div class="gallery">${withReports.map((s) => reportFigure(s, { compact: true })).join('')}</div>` : ''}
  </section>

  <section aria-labelledby="choice-title">
    <span class="eyebrow">Sponsorship with true choice</span>
    <h2 id="choice-title" style="margin-top:12px">${esc(c.sponsorship.title)}</h2>
    <p style="margin-top:16px">${esc(c.sponsorship.body)}</p>
    <div class="rules">
      <div class="rule"><h3>Both sides say yes</h3><p>A sponsor appears only when it has accepted and the creator has accepted. Either side can withdraw.</p></div>
      <div class="rule"><h3>The creator picks the placement</h3><p>Which class, which game night, which set carries which sponsor is the creator's call. A sponsor never becomes a filter on who can attend.</p></div>
      <div class="rule"><h3>Sponsors get the report</h3><p>They see the counts for what they backed, floored under five. They never get a list of people.</p></div>
    </div>
  </section>

  ${
    c.schedule
      ? `<section aria-labelledby="now-title">
    <span class="eyebrow">On the air this season</span>
    <h2 id="now-title" style="margin-top:12px">Ready-made first broadcasts.</h2>
    <p style="margin-top:16px">${esc(c.schedule.intro)} Dates and prices as listed on ${esc(c.schedule.source)}, read ${esc(fmtDate(c.readOn))}.</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Price</th><th scope="col">Natural pairing</th></tr></thead>
        <tbody>${c.schedule.rows.map(([d, t, p, n]) => `<tr><td class="d">${esc(fmtDate(d))}</td><td>${esc(t)}</td><td class="mono">${esc(p)}</td><td>${esc(n)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`
      : ''
  }
</div>

<footer>
  <div class="wrap">
    <span class="eyebrow">Sources</span>
    <ul>${c.sources.map(sourceItem).join('')}</ul>
    <p class="note">${esc(c.disclaimer)} Facts come from the public pages above, read ${esc(fmtDate(c.readOn))}. Report pages come from a local run of OurSharedEvents with simulated visitors.</p>
  </div>
</footer>

<script>
(function () {
  var CH = ${JSON.stringify(stationData).replace(/</g, '\\u003c')};
  var X0 = 20, X1 = 680, F0 = 88, F1 = 108, NS = "http://www.w3.org/2000/svg";
  function xOf(f) { return X0 + (f - F0) / (F1 - F0) * (X1 - X0); }
  var ticks = document.getElementById("ticks"), labels = document.getElementById("labels");
  for (var f = 88; f <= 108.001; f += 0.5) {
    var major = Math.abs(f % 2) < 0.01, x = xOf(f), l = document.createElementNS(NS, "line");
    l.setAttribute("x1", x); l.setAttribute("x2", x); l.setAttribute("y1", major ? 14 : 22); l.setAttribute("y2", 46);
    l.setAttribute("class", "tick" + (major ? " major" : "")); ticks.appendChild(l);
    if (major) { var t = document.createElementNS(NS, "text"); t.setAttribute("x", x); t.setAttribute("y", 70); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "lbl"); t.textContent = f; labels.appendChild(t); }
  }
  var btns = CH.map(function (c) { return document.getElementById("tab-" + c.id); });
  var needle = document.getElementById("needle");
  function tune(i, fromUser) {
    var c = CH[i];
    btns.forEach(function (b, j) { b.setAttribute("aria-selected", j === i ? "true" : "false"); b.tabIndex = j === i ? 0 : -1; });
    CH.forEach(function (k, j) { document.getElementById("panel-" + k.id).hidden = j !== i; });
    needle.style.transform = "translateX(" + xOf(c.f) + "px)";
    document.getElementById("freq").textContent = c.f.toFixed(1);
    document.getElementById("freqname").textContent = c.name;
    if (fromUser) { try { history.replaceState(null, "", "#" + c.id); } catch (e) {} }
  }
  btns.forEach(function (b, i) {
    b.addEventListener("click", function () { tune(i, true); });
    b.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowRight") n = (i + 1) % CH.length;
      if (e.key === "ArrowLeft") n = (i - 1 + CH.length) % CH.length;
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = CH.length - 1;
      if (n !== null) { e.preventDefault(); tune(n, true); btns[n].focus(); }
    });
  });
  function fromHash() { var h = (location.hash || "").slice(1); var i = CH.findIndex(function (c) { return c.id === h; }); return i < 0 ? 0 : i; }
  tune(fromHash(), false);
  window.addEventListener("hashchange", function () { tune(fromHash(), false); });
})();
</script>
`;
}
