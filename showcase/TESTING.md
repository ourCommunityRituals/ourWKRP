# Creator showcase: test pyramid

The showcase follows the OSE model: the full pyramid, security first, every check
born red (watched failing on an injected fault before it is trusted), and a check
counts only if CI runs it. Every layer is a job in `.github/workflows/showcase.yml`.

What is tested is the container, not any one creator. CI builds only the fictional
fixture (`fixtures/sample-creator.json`). The contract layer also checks every real
creator file present in `creators/` when it runs on the owner's machine.

**Born red, kept red.** `tests/born-red.test.mjs` (job *Showcase: born red*)
copies `lib/` into `lib/.mutants/<name>`, plants one fault, and runs the same check
the layer runs on the real code. If any check passes on its fault, the job is red.
The faults below are the ones it plants, on every run.

## 0. Security (job *Showcase 0: security*; a red here stops every later job)

`tests/security.test.mjs`, checks in `tests/checks.mjs`.

| Check | Fails when | Planted fault |
|---|---|---|
| Escaping | Any creator or report field renders as markup. A hostile creator puts `<script>`, `"><img onerror>`, `'><svg onload>` and `</script>` in every string field, station names included; the page must keep exactly one `<script>`, no live handler and no non-allowlisted URL. | `esc()` dropped from a text field; from an attribute; the script data's `<` guard removed. |
| Link allowlist | A source link is not `https:` (`javascript:`, `http:`, `data:`). | `safeHttpsUrl` bypassed. |
| Image allowlist | A report image is anything but a local `img/<name>.jpg` or `.png`. | Any string kept as an image path. |
| No secrets published | The built folder (page and public `reports.json`) carries a signed link, token, key or JWT. | `publicReport` keeps `reportPath`; and that plus the publish gate off. |
| Publish gate | The build writes a page carrying an email, a signed link or an anonymous cookie. | Gate off; email detector blind. |
| Never who | The rendered page holds an email, anonymous cookie, anonymous id or UUID. | (as the gate) |
| Floor | A count under 5 prints as a number. It must read "Fewer than 5". | `floorText` returns `n`; the floor moved to 4. |
| Local-only seeding | The base guard accepts anything but `127.0.0.1` / `localhost` with a port, or a script does not call it. | The guard accepts any `http(s)` URL. |
| CSP readiness | Any inline event handler. | `onclick` on a tab. |
| Git hygiene | `.gitignore` stops ignoring `work/`, `out/`, the env file or real creator files. | (structural) |

Not yet a check: fonts from the page's own origin. The page loads Google Fonts,
which is fine for a private artifact; when ourWKRP serves the page under its CSP,
the fonts move to its own origin and this row becomes a check.

## 1. Lint (job *Showcase 1: lint*)

`npm run lint:showcase`: ESLint on every `showcase/**/*.mjs`. Born red: an
undefined name in a showcase module is an error. JSON parse of every committed
JSON file runs in the contract layer.

## 2. Contract (job *Showcase 2: contract*)

`tests/contract.test.mjs`.

- Creator files validate against `lib/schema.mjs` (zod, strict): copy for every station, https sources, a read date, a disclaimer. Planted: non-https allowed; unknown fields allowed.
- Every station's category exists in `categories.json` and is open; Spirit stays `future`. Planted: future categories open.
- `theme.css` is exactly what the pinned `@ocr/ui` generates, and the renderer holds no colour value. Planted: a hex colour in the renderer.
- The SharedReport fields the seed reads (`qr_token`, the mint-link `token`, `distinct_scanners`) are asserted against the real worker in the integration job; the seed throws on any missing field.

## 3. Unit (job *Showcase 3: unit*)

`tests/unit.test.mjs`: `floorText`, the totals per shape, the hour spread (each
shape's hours sum to the scans sent), the pacer (never more than 50 in any
61-second window, on a fake clock), the station merge, dates, `publicReport`.
Planted: an hour of exactly 5 dropped; every hour given the first count; the
pacer never waits; the catalog overriding the creator; US date order.

## 4. Integration (job *Showcase 4: integration*)

A real OSE worker, fetched at `.ose-ref`, runs locally under `wrangler dev`.
The seed creates the fixture's events, poster codes and real scans, runs the
nightly roll-up, mints signed links; the capture step photographs each real
report; the build writes the page. `tests/integration/check-reports.mjs` then
requires: every report answered 200, every scan counted, each total equals the
scans sent less the hours under 5 (medium: 30 sent, 27 shown; low: 21 sent, 19
shown), three images per report, no identity on the real report pages, and
nothing private in the publishable folder. Born red in the born-red job: an
unfloored total, a lost scan and an email on a report page are each caught.

## 5. End to end (job *Showcase 5: end to end*)

Playwright (`playwright.config.mjs`, `tests/e2e/`) on the built fixture page at
375, 768 and 1280 px, in both themes: no page errors, exactly one `<h1>`,
nothing scrolls sideways, every report image loads, the tuner works by click,
by arrow keys and by Home/End, a station link opens on its station, and axe finds
no WCAG 2.2 A/AA violation. Born red on the PR that added it: a planted fault
per check was pushed and watched failing in CI before the fix (see the PR).

## Staging layer

Once ourWKRP serves the page, the same end-to-end set runs against ourWKRP
staging, with reports from OSE staging seeded the same way.
