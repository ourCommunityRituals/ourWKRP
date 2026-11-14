# Creator showcase: test pyramid

The showcase follows the OSE model: the full pyramid, security first, every check
born red (watched failing on an injected fault before it is trusted), and a check
counts only if CI runs it. Every layer is a job in `.github/workflows/showcase.yml`.

What is tested is the container, not any one creator. CI builds only the fictional
fixture (`fixtures/sample-creator.json`) and its seed plan
(`fixtures/sample-ose-events.json`). The contract layer also checks every real
creator file present in `creators/` when it runs on the owner's machine.

**Born red, kept red.** `tests/born-red.test.mjs` (job *Showcase: born red*)
copies `lib/` into `lib/.mutants/<name>`, plants one fault, and runs the same
check the layer runs on the real code. If any check passes on its fault, the job is red.
The faults below are the ones it plants, on every run.

**Two stand-ins, one real worker.** The security, contract, unit and end-to-end
layers read OSE through `tests/fake-ose.mjs`, which answers the three public reads
in OSE's own response shapes, built from the seed plan. The integration layer runs
the same build against a real OSE worker at `.ose-ref`, on this machine (never
staging). The staging layer is below.

## What the build reads from OSE (S3, S4, S9)

Public reads only, GET, no key, no cookie (`lib/ose.mjs`):

| Read | For |
|---|---|
| `GET /api/v2/events?brand=<oseBrand>` | Which linked events are public on the creator's brand. Anything else drops off. |
| `GET /api/v2/events/:id` | Each linked event's When, Where and How: dates, start, timezone, the 5W fields. Beside the event, the declared series it sits on (label, cadence, weekday, hour), or none. |
| `GET /api/v2/events/:id/poster-bundle?deployment=<placement>` | Its codes: the showcase placement's `/q` code and the event's `/s` codes. Not read for a past event. |
| `GET /api/v2/events/:id/sponsor-bundle?surface=public` | Its sponsors, as OSE lists them: both sides accepted and the event has sponsors on. The build keeps a name and, when OSE gives one, the campaign (`id`, `title`); tokens, logo, website and tier are left behind. Not read for a past event. A bundle that cannot be read stops the build. |
| `GET /brands/<oseBrand>/calendar.ics` | Whether OSE serves the brand's calendar feed. Listed on the creator page only on a 200 that starts `BEGIN:VCALENDAR`; a 404, an edge challenge or any other body leaves it off and fails nothing. Its text is held to the neutral-name rule. |

The checks hold the build to this list read by read (`READS` in `tests/checks.mjs`): a new read is added there on purpose.

The build reads a local worker (`127.0.0.1` / `localhost`) or OSE staging
(`https://stg.oursharedevents.com`), never production.

## 0. Security (job *Showcase 0: security*; a red here stops every later job)

`tests/security.test.mjs`, checks in `tests/checks.mjs`.

| Check | Fails when | Planted fault |
|---|---|---|
| Escaping | Any creator, report or OSE field renders as markup, on any page. A hostile creator puts `<script>`, `"><img onerror>`, `'><svg onload>` and `</script>` in every string field, station names included, and OSE serves them in every event field and code word. The creator page keeps exactly one `<script>`, a station page none; no live handler; no URL off the allowlist. | `esc()` dropped from a text field; from an attribute; from an OSE event title; from a code word; the script data's `<` guard removed. |
| Link allowlist | A source or place link is not `https:`. | `safeHttpsUrl` bypassed for sources; for places. |
| Plain place links (S1) | A place link is not exactly the URL the creator file gives, or goes through a counting path (`/q`, `/s`, a tracking parameter). | `utm_source` appended to place links. |
| Image allowlist | A report image is anything but a local `img/<name>.jpg` or `.png`. | Any string kept as an image path. |
| No secrets published | The built folder (every page and the public `reports.json`) carries a signed link, token, key or JWT. | `publicReport` keeps `reportPath`; and that plus the publish gate off. |
| Publish gate | The build writes a page carrying an email, a signed link or an anonymous cookie, on the creator page or a station page. | Gate off; station pages unchecked; email detector blind. |
| Never who | Any rendered page holds an email, anonymous cookie, anonymous id or UUID. | (as the gate) |
| Floor | A count under 5 prints as a number. It must read "Fewer than 5". | `floorText` returns `n`; the floor moved to 4. |
| Local-only seeding | The base guard accepts anything but `127.0.0.1` / `localhost` with a port, or a script does not call it. | The guard accepts any `http(s)` URL. |
| OSE read base (S3) | The build would read production, plain-http staging, a look-alike host, or any other base. | Any `oursharedevents.com` URL accepted. |
| Read only (S3) | A read sends a key, a cookie or credentials, or is not a GET of the three public reads. | An `Authorization` header added. |
| Neutral names (S3) | OSE text names the creator, a private name, a venture or one of her links (title, 5W fields, code labels) and the build carries on. Each word of a name counts on its own, and a name shorter than 4 letters counts, both as whole words; a longer word that only contains a name ("Kaiser" for "Kai") does not stop the build. | The check skipped; code labels unchecked; names under 4 letters skipped; name words not added; whole-word matching dropped. |
| File first (S3) | OSE is read before the creator file is checked: a file with no `oseBrand`, or a place link that is not a URL, makes any read. | The readOse file check off. |
| No lost codes (S4) | An upcoming public event's poster bundle fails, or OSE does not know its placement, and the build carries on with fewer codes. | Each of the two stops removed. |
| Drop, not fail (S3) | A linked event that is missing, a draft, or another brand's reaches a page, or stops the build. | The per-event brand check removed. |
| Codes are OSE codes (S4) | A code from the bundle is not `<OSE origin>/q/<token>` or `<OSE origin>/s/<code>` with nothing after the path. | Any `/s` URL accepted; any placement URL accepted. |
| Code gate (S4) | The build publishes a page with a code on another host, to a form path, or with a form query; or a QR or code URL sits in markup the gate does not read. | The page gate's code check off; its count of QRs and code URLs off. |
| No form codes (S4) | A check-in or register code, or a `/q/…?type=<form>` link, shows as a code. Forms are the identified side. | The form kinds emptied; the placement code keeps its form query. |
| QR carries its link (S4) | A code's QR does not decode (jsQR, an independent decoder) to exactly the URL its link carries and shows; or the page gate passes such a QR. | The QR drawn from another URL; the gate's QR check off. |
| No past codes (S4) | A past event shows a card or a code, or a frequency with nothing upcoming shows a code or fails to say so. | `isPast` always false. |
| CSP readiness | Any inline event handler, on any page. | `onclick` on a tuner link. |
| Git hygiene | `.gitignore` stops ignoring `work/`, `out/`, the env file or real creator files. | (structural) |

Not yet a check: fonts from the page's own origin. The page loads Google Fonts,
which is fine for a private artifact; when ourWKRP serves the page under its CSP
(S7), the fonts move to its own origin and this row becomes a check.

## 1. Lint (job *Showcase 1: lint*)

`npm run lint:showcase`: ESLint on every `showcase/**/*.mjs`. Born red: an
undefined name in a showcase module is an error. JSON parse of every committed
JSON file runs in the contract layer.

## 2. Contract (job *Showcase 2: contract*)

`tests/contract.test.mjs`.

- Creator files validate against `lib/schema.mjs` (zod, strict), contract v2 (S1). A version 1 file (places as pairs, no v2 field) still validates; so does creator #1's private file on the owner's machine.
- Refused, each by its own case: a non-https source or place; a place on an unknown station or of an unknown kind; an event or campaign on an unknown frequency; one event on two frequencies; an event with no or an unknown intent; an id that is not OSE-shaped; linked events with no `oseBrand`; a pop-up with no `until`, or an `until` on anything else; a frequency on air with no `why`; a slot with a bad cadence, a missing day or week, a time with no timezone, an unknown timezone or mode, or a kind outside its category's `eventKinds`; a schedule row naming an unlinked event.
- S10, the layout and display menu: an unknown `layout`, `stationOrder`, `display` or section, a section switch that is not true or false, and hidden sources are each refused; every listed option is accepted. Planted: each option taking any string; an unknown section accepted; a switch of any type accepted; sources hideable.
- A demo event's own `placements`: refused when empty, over 4, blank or over 40 characters; a demo event with none stays valid. Planted: any number accepted; a blank or endless label accepted.
- Planted: non-https allowed; unknown fields allowed; future categories open; a version 1 place refused; the frequency check removed; `why` not required; a pop-up's window not required; slot kinds not checked.
- Every station's category exists in `categories.json` and is open; Spirit stays `future`.
- `theme.css` is exactly what the pinned `@ocr/ui` generates, and the renderer holds no colour value (the QR's paper and ink are tokens too). Planted: a hex colour in the renderer.
- The OSE fields the seed and the build read (`qr_token`, `id` of a placement, the mint-link `token`, `distinct_scanners`, the brand list's `items`, the event's `item`, the bundle's `links`, `deploymentId` and `slots`) are asserted against the real worker in the integration job; the seed and the build throw on a missing one.

## 3. Unit (job *Showcase 3: unit*)

`tests/unit.test.mjs`.

- The floor, the totals per shape, the hour spread, the pacer (never more than 50 in any 61-second window, on a fake clock), the station merge, dates, `publicReport`. Planted: an hour of exactly 5 dropped; every hour given the first count; the pacer never waits; the catalog overriding the creator; US date order.
- Programme slots: cadence, day, week of the month (first … last) and time, read in the slot's own timezone; "On air" text built from slot fields only; 12-hour times. Planted: the week of the month off by one; times read in UTC; midnight reading 0 am.
- Time: an event later today is upcoming, yesterday is past, a pop-up reads with its window. Planted: today reads as past.
- The four intents: only a `programme` event stands under On air, as its slot's next date; a `one-off`, `pop-up` or `trial` never does, even on the slot's own day and time. A programme event off every slot, a pop-up with no start time and a mode unlike its slot's each stop the build, for upcoming events only: a past event is not on the page, so a programme that has since moved never stops a later build. Frequency decides where an event shows; Lead shows the whole dial; soonest first. Planted: a trial under On air; a programme off its slots accepted; a mode unlike its slot accepted; every event on every station; latest first; past events held to today's programme.
- On air carries no OSE text, a slot with nothing upcoming reads "Next date to be announced", and each intent reads its own label. Planted: an OSE title in the On air list.
- Every programme event on a slot reads that slot's purpose as its Why, not only the slot's next one. Planted: only the first event reads it.
- The creator page's When list runs in the stations' order (one comparator, `soonestFirst`): a date-only event comes after a timed event on the same day. Planted: the dial sorting by bare date.
- S5: a schedule row that is now an OSE event leaves the copied table; the rest stay, labelled "Copied from …". Planted: linked rows kept.
- The page set: the creator page plus one page per station, exactly one `<h1>` each, Who, What, When, Where and How on every page, each station marked in the tuner. Planted: a station page loses its `<h1>`.
- A demo event's codes hang under its own `placements` when it names any, else under its size's. Planted: a station's own labels ignored.
- The fixed sentences fit any instance: none says "the creator" or lists "class, set or game night"; they name the instance and list its own event kinds in station order; a one-kind instance reads that kind alone, and one with none reads "event". Read from the visible text only. Planted: "the creator" back; the fixed list back; the consent rule naming nobody; no fallback for an instance with no kinds; kinds read from every station but the first. An unescaped kind is caught by the escaping check.
- S10 layout: the same station links as a dial, a list or a grid, on every page; list and grid draw no dial and carry each station's title; a file with no layout is exactly the dial. Planted: a list drawing the dial; a card without its title; station pages ignoring the layout; another default.
- S10 station order: the file's order by default; by next event when asked, a station with nothing upcoming after the busy ones, Lead last. Planted: the option ignored; Lead not last; the quiet first; ordering when nobody asked.
- S10 sections: each switch hides its own section and nothing else; sources always show; a reporting section with nothing in it is not drawn. Planted: each section unhideable; a station still showing its report; an empty reporting section; one switch hiding them all.
- S11 TV board: built only for `display: tv`; a panel per station with something upcoming, never Lead; at most two events a panel; its codes are station-page codes; no report, image, count or placement label; the dwell is 3 s + reading at 100 words a minute + 2 s and never under 14 s; a key or a tap holds for at least 20 s; a Pause button; reduced motion stops the rotation; a hidden panel is hidden. Planted: built unasked; never built; Lead rotating; a count on the board; every event on one panel; an 8 s dwell; a 5 s hold; no Pause; a key that does not hold; rotation under reduced motion; a hidden panel showing.
- The escaping check now renders every layout and the TV board, not only the default page set. Planted: a station title unescaped on the board; a card title unescaped in the list and grid layouts.
- The seed plan's dates and UTC instants, across a DST change.

## Overlap

`overlapProblems` (unit): an event with `also` shows on each station it names and once on Lead; its codes show only on the station it lives on, and elsewhere the card names that station and links to it; its sponsor travels with it; the TV board keeps the codes; the front page lists it once under both stations; a borrowed programme event is not held to the borrowing station's slots and never stands under its On air; a campaign with `also` shows its partner on each station it names; `also` refuses an unknown station, its own station, Lead and a repeat, and an event is still linked once; a station that only borrows events must still state its why. The integration verdict counts a card on every station an event names and its codes on its home station only.

## Declared series (S15)

`seriesProblems` (unit): the build keeps five fields of an event's series (id, name, cadence, weekday, hour) from the `series` beside `item` in OSE's public event read; an upcoming programme event that OSE says sits on no declared series stops the build; a series that states another cadence, weekday or hour than the slot stops it too, while a series that names no day or hour does not; a one-off, pop-up or trial needs none; an OSE that does not say either way is not held to the rule and shows no series; the card names the series; a series named after the creator stops the build. Integration: the seed declares the fixture's series on the real worker the way an organizer does, and `check-ose.mjs` requires each card on that series to name it and no other card to.

## Partners (S9)

- **Sponsor strip** (`sponsorProblems`, security): on an event card, below the title and date and above everything else; only the sponsors OSE's public bundle lists (one side's yes, a pending answer and a past event's sponsor reach no page); a name and nothing else of the row; the one link is the event's own SPONSOR `/s/` code, and there is none without that code; no `/impression` or `/click` request; a sponsor name is never in or on a control; a bundle that fails, has no list, or names the creator stops the build.
- **Station partner** (`partnerProblems`, unit): once at the top of the station though several events list it, with its campaign named and the soonest event's SPONSOR code; only on the frequency the creator file names, and only when OSE lists a sponsor under that campaign; a campaign on Lead shows on Lead alone; the TV board names it with no link.
- **Calendar feed** (`calendarProblems`, unit): one plain link on the creator page, exactly the feed's URL; left off on a 404, a 403 or a body that is not a calendar; a feed that names the creator, folded across lines or not, stops the build; nothing is read for a creator with no events.
- Integration, calendar: the worker at `.ose-ref` serves the brand's feed (OSE S8, merged), so `check-ose.mjs` asks the worker for it and requires exactly that URL once, on the front page. Were the worker to stop serving it, the verdict would require no link.
- Integration: the seed adds the fixture's sponsors through OSE's admin API and writes each side's answer as the plan gives it (the sponsor's own yes has no script-held token, so it is written to the throwaway local database). `check-ose.mjs` then requires each station's strips to be exactly the plan's both-sides sponsors.

## 4. Integration (job *Showcase 4: integration*)

A real OSE worker, fetched at `.ose-ref`, runs locally under `wrangler dev`.

- The seed creates the fixture's demo events, poster codes and real scans, runs the nightly roll-up and mints signed links. With `--plan` it also creates the fixture's linked events on its brand `showcase-sample`: two programme classes, a trial, a past class, a pop-up and a one-off (all with neutral text), a draft, and one on another brand. It saves their poster codes (including a check-in code, to prove it never shows), adds one placement per station event ("Showcase: Teach page"), and writes `work/sample-creator/creator.json` with the run's real ids.
- The capture step photographs each real report; the build reads OSE's public API and writes every page.
- `tests/integration/check-reports.mjs` requires: every report answered 200, every scan counted, each total equals the scans sent less the hours under 5 (medium: 30 sent, 27 shown; low: 21 sent, 19 shown), three images per report, no identity on the real report pages, and nothing private in the publishable folder.
- `tests/integration/check-ose.mjs` requires, from the seed plan rather than the renderer: each upcoming, public, on-brand event has one card on its station page and on Lead; the draft, the other brand's and the past event have none; each card shows its placement's `/q` code and every non-form `/s` code; and every code on every page answers the live worker with a 302 that does not lead to a form.
- `check-reports.mjs` also requires each report's placement labels to be the ones its station names (the fixture's stall: "Table card, Stall sign").
- Born red in the born-red job: an unfloored total, a lost scan, codes hung under the wrong labels and an email on a report page; a lost card, a draft on a page, a dead code and a code leading to a form are each caught.

## 5. End to end (job *Showcase 5: end to end*)

Playwright (`playwright.config.mjs`, `tests/e2e/`) on the built fixture (`tests/e2e/build-site.mjs`, OSE from the stand-in) at 375, 768 and 1280 px, in both themes. On the creator page and every station page: no page errors, exactly one `<h1>`, nothing scrolls sideways, every image loads, every tap target outside running text is at least 44 px, the tuner links every station and marks the current one, and axe finds no WCAG 2.2 A/AA violation. Then: a channel opens its station page and the back link returns; an old `#wear` link opens the Wear page; Teach shows its programme On air with a next date and "Next date to be announced"; each code shows a QR and a link carrying the same OSE `/q` or `/s` URL; Lead shows every frequency's events and sends codes to their station pages. Born red on the PR that added it: a planted fault per check was pushed and watched failing in CI before the fix (see the PR).

The layout and display menu is run pairwise, not in every combination: beside the default site the setup builds `/list` (list layout, stations by next event, the TV board, scatter hidden) and `/grid` (grid layout, values and the copied schedule hidden), and every per-page check above runs on every page of all three. Then: the list is one column with no dial, soonest station first; a grid card opens its station and marks it; a hidden section is gone and the others stay. On the TV board, with the clock driven by Playwright: one panel shows at a time and the next follows after its dwell; a key holds the panel for 20 s with the time left on screen; Pause stops it until Resume; with reduced motion every panel shows and nothing rotates; codes show, and no report, image, table or count. Born red locally before the push, one planted fault at a time, each failing its own test: a 5 s hold, a Pause that does nothing, rotation under reduced motion, panels that all show, a board that never moves on, a list in three columns, a card that does not mark itself, an unhideable section, a count on the board.

## Not checked yet, and why

| Plan rule | Waits on |
|---|---|
| A slot's mode equals each attached event's mode | OSE S13 (`attendance_mode`). The check is built and born red on a stand-in mode; it runs on real events once OSE serves the field. |
| A campaign partner at the top of its station, against a real worker | OSE S14 (campaigns in the public sponsor bundle). Built and born red on the stand-in. The integration seed already attaches the fixture's placements to a campaign, and `check-ose.mjs` asks the worker whether its bundle names campaigns: once `.ose-ref` moves past S14 it expects the partner with no further change. |
| Promoting a trial never changes its past dates or counts | OSE S15. |

## Staging layer

Once ourWKRP serves the page (S7), the same end-to-end set runs against ourWKRP
staging, with events and reports from OSE staging. Until then the owner builds
creator #1's private page from OSE staging by hand (`build-page.mjs --ose
https://stg.oursharedevents.com`), where the neutral-name check guards her name.
