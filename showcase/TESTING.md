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

## What the build reads from OSE (S3, S4)

Public reads only, GET, no key, no cookie (`lib/ose.mjs`):

| Read | For |
|---|---|
| `GET /api/v2/events?brand=<oseBrand>` | Which linked events are public on the creator's brand. Anything else drops off. |
| `GET /api/v2/events/:id` | Each linked event's When, Where and How: dates, start, timezone, the 5W fields. |
| `GET /api/v2/events/:id/poster-bundle?deployment=<placement>` | Its codes: the showcase placement's `/q` code and the event's `/s` codes. Not read for a past event. |

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
| Neutral names (S3) | OSE text names the creator, a private name, a venture or one of her links (title, 5W fields, code labels) and the build carries on. | The check skipped; code labels unchecked. |
| Drop, not fail (S3) | A linked event that is missing, a draft, or another brand's reaches a page, or stops the build. | The per-event brand check removed. |
| Codes are OSE codes (S4) | A code from the bundle is not `<OSE origin>/q/<token>` or `<OSE origin>/s/<code>` with nothing after the path. | Any `/s` URL accepted; any placement URL accepted. |
| Code gate (S4) | The build publishes a page with a code on another host, to a form path, or with a form query. | The page gate's code check off. |
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
- Planted: non-https allowed; unknown fields allowed; future categories open; a version 1 place refused; the frequency check removed; `why` not required; a pop-up's window not required; slot kinds not checked.
- Every station's category exists in `categories.json` and is open; Spirit stays `future`.
- `theme.css` is exactly what the pinned `@ocr/ui` generates, and the renderer holds no colour value (the QR's paper and ink are tokens too). Planted: a hex colour in the renderer.
- The OSE fields the seed and the build read (`qr_token`, `id` of a placement, the mint-link `token`, `distinct_scanners`, the brand list's `items`, the event's `item`, the bundle's `links`, `deploymentId` and `slots`) are asserted against the real worker in the integration job; the seed and the build throw on a missing one.

## 3. Unit (job *Showcase 3: unit*)

`tests/unit.test.mjs`.

- The floor, the totals per shape, the hour spread, the pacer (never more than 50 in any 61-second window, on a fake clock), the station merge, dates, `publicReport`. Planted: an hour of exactly 5 dropped; every hour given the first count; the pacer never waits; the catalog overriding the creator; US date order.
- Programme slots: cadence, day, week of the month (first … last) and time, read in the slot's own timezone; "On air" text built from slot fields only; 12-hour times. Planted: the week of the month off by one; times read in UTC; midnight reading 0 am.
- Time: an event later today is upcoming, yesterday is past, a pop-up reads with its window. Planted: today reads as past.
- The four intents: only a `programme` event stands under On air, as its slot's next date; a `one-off`, `pop-up` or `trial` never does, even on the slot's own day and time. A programme event off every slot, a pop-up with no start time and a mode unlike its slot's each stop the build. Frequency decides where an event shows; Lead shows the whole dial; soonest first. Planted: a trial under On air; a programme off its slots accepted; a mode unlike its slot accepted; every event on every station; latest first.
- On air carries no OSE text, a slot with nothing upcoming reads "Next date to be announced", and each intent reads its own label. Planted: an OSE title in the On air list.
- S5: a schedule row that is now an OSE event leaves the copied table; the rest stay, labelled "Copied from …". Planted: linked rows kept.
- The page set: the creator page plus one page per station, exactly one `<h1>` each, Who, What, When, Where and How on every page, each station marked in the tuner. Planted: a station page loses its `<h1>`.
- The seed plan's dates and UTC instants, across a DST change.

## 4. Integration (job *Showcase 4: integration*)

A real OSE worker, fetched at `.ose-ref`, runs locally under `wrangler dev`.

- The seed creates the fixture's demo events, poster codes and real scans, runs the nightly roll-up and mints signed links. With `--plan` it also creates the fixture's linked events on its brand `showcase-sample`: two programme classes, a trial, a past class, a pop-up and a one-off (all with neutral text), a draft, and one on another brand. It saves their poster codes (including a check-in code, to prove it never shows), adds one placement per station event ("Showcase: Teach page"), and writes `work/sample-creator/creator.json` with the run's real ids.
- The capture step photographs each real report; the build reads OSE's public API and writes every page.
- `tests/integration/check-reports.mjs` requires: every report answered 200, every scan counted, each total equals the scans sent less the hours under 5 (medium: 30 sent, 27 shown; low: 21 sent, 19 shown), three images per report, no identity on the real report pages, and nothing private in the publishable folder.
- `tests/integration/check-ose.mjs` requires, from the seed plan rather than the renderer: each upcoming, public, on-brand event has one card on its station page and on Lead; the draft, the other brand's and the past event have none; each card shows its placement's `/q` code and every non-form `/s` code; and every code on every page answers the live worker with a 302 that does not lead to a form.
- Born red in the born-red job: an unfloored total, a lost scan and an email on a report page; a lost card, a draft on a page, a dead code and a code leading to a form are each caught.

## 5. End to end (job *Showcase 5: end to end*)

Playwright (`playwright.config.mjs`, `tests/e2e/`) on the built fixture (`tests/e2e/build-site.mjs`, OSE from the stand-in) at 375, 768 and 1280 px, in both themes. On the creator page and every station page: no page errors, exactly one `<h1>`, nothing scrolls sideways, every image loads, every tap target outside running text is at least 44 px, the tuner links every station and marks the current one, and axe finds no WCAG 2.2 A/AA violation. Then: a channel opens its station page and the back link returns; an old `#wear` link opens the Wear page; Teach shows its programme On air with a next date and "Next date to be announced"; each code shows a QR and a link carrying the same OSE `/q` or `/s` URL; Lead shows every frequency's events and sends codes to their station pages. Born red on the PR that added it: a planted fault per check was pushed and watched failing in CI before the fix (see the PR).

## Not checked yet, and why

| Plan rule | Waits on |
|---|---|
| A slot's mode equals each attached event's mode | OSE S13 (`attendance_mode`). The check is built and born red on a stand-in mode; it runs on real events once OSE serves the field. |
| A `programme` event sits on a declared series | OSE S15. Today the build requires it to match a slot. |
| A campaign is shown only while one of its events is upcoming, and only with both sides' consent | OSE S14 (campaigns in the public sponsor bundle) and OW S9. `campaigns` links are validated (S1) and not yet shown. |
| No impression or click beacon on the page | OW S9, which adds the sponsor strip. The page fires no request today. |
| Promoting a trial never changes its past dates or counts | OSE S15. |

## Staging layer

Once ourWKRP serves the page (S7), the same end-to-end set runs against ourWKRP
staging, with events and reports from OSE staging. Until then the owner builds
creator #1's private page from OSE staging by hand (`build-page.mjs --ose
https://stg.oursharedevents.com`), where the neutral-name check guards her name.
