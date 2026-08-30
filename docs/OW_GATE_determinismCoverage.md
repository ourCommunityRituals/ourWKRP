# OW_GATE_determinismCoverage

**Property under evaluation:** ourWKRP's frontend, backend, and database are
**deterministic** — identical stored data produces identical output.

**Why it is load-bearing:** the product claim rendered on the landing page is
"The human answer to AI playlists. Real people. Real taste. No algorithm."
(`src/templates/connect.html`). That claim is a statement about the code, not
just about marketing. A probabilistic ranking call, an unseeded random, or a
tie-unstable `ORDER BY` each make it false — and each would arrive looking like
an ordinary change.

Status: **live** at the three applicable levels (see grid). Established
2026-08-30.

---

## 1. The evaluation rule

Full coverage is what you strive for. It is not always reachable, and any
tester worth their salt knows it — so the discipline is not "a test in every
cell," it is **push as many tests as far down the pyramid as possible, then
integration wherever you can, then _some_ E2E.** Deep FE testing is gravy: real
value, but expensive, so you buy a thin slice of it deliberately rather than a
matrix of it by reflex.

The judgment call is the deliverable. As you build you hit places where full
coverage is not worth what it costs; you decide, and you **record the decision**
so the next person inherits the reasoning instead of re-litigating it or
"filling in" the blank cell later.

**A level is covered when one of these is true:**

| verdict | requirement |
|---|---|
| **COVERED** | Both a **PASS** case and a **FAIL** case are automated at that level. |
| **N/A** | The level is ruled inapplicable **with a recorded reason**. |

**A pass-only assertion is not coverage.** A gate that has only ever been shown
passing cannot tell you whether it still works. The failure path is the half
that protects you, so it must be automated — not demonstrated once by hand and
described in a commit message.

**A test that can silently assert nothing is not coverage either.** A vacuous
skip, an empty scan, or a query returning zero rows all report green. Every
level below carries an explicit non-vacuity assertion for this reason.

**N/A is a first-class verdict, not a gap.** An honest N/A with a reason is
worth more than a low-value test, because it records the judgment and stops the
cell being filled by reflex later.

This mirrors how the brain treats invariants: `applies_to` is a deliberate list,
and parity means *conformant on the applicable ones*, never a perfect score.

---

## 2. Applicability grid

11 levels evaluated. **4 apply** — weighted to the bottom (20 unit cases, 4
integration, 9 static, 2 E2E). 7 ruled N/A.

| # | Pyramid level | Verdict | Reasoning |
|---|---|---|---|
| 1 | S0 Security / secret scan | **N/A** | Scope is credential leakage. Determinism is not a secrets property. |
| 2 | Lint & Type Check | **N/A** | Not expressible in the type system — "this sort key is unique" is a schema fact, not a type. A custom ESLint rule was considered and rejected: it would duplicate level 3 at higher cost and would not see SQL inside template literals any more cheaply. |
| 3 | **Unit** | **COVERED** | The only level where the **failure path** can be automated. The scanners are pure `(source) => Violation[]` functions, so each is fed a broken fixture and must report. Cost: one file. Value: highest of any level — it is what keeps the other gates honest. |
| 4 | **Integration** | **COVERED** | The only level that proves behavior rather than text. Runs the shipped queries against real SQLite via Miniflare + real migrations, seeded with **deliberate ties**. A regex cannot tell you whether SQLite returns stable rows; this can. |
| 5 | Contract | **N/A** | Contract tests pin response **schema**, and brain invariant #16 `api_response_schema_stability` governs schema explicitly — *not* row order. Asserting ordering here would couple the Pact to row order and create a false contract that breaks on legitimate re-ranking. |
| 6 | **Security (L0 static)** | **COVERED** | Repo-wide gate. Runs the scanners over every file in `src/`, `migrations/`, and the templates on every PR, plus `wrangler.toml` bindings and runtime dependencies. Cost: near zero. Value: catches the ordinary-looking dependency bump. |
| 7 | Fuzz / Property | **N/A** | Determinism here is not a property of arbitrary *user input* — the scanners consume source text, not request payloads. A `fast-check` pass would assert "does not throw" over random strings, duplicating level 3 while finding nothing this codebase can hit. |
| 8 | Performance | **N/A** | Orthogonal axis. Determinism constrains *what* is returned; performance constrains *how fast*. No interaction. |
| 9 | Postman API | **N/A** | Same reasoning as level 5 — response shape, not row order. |
| 10 | **E2E (Playwright)** | **COVERED — thin slice** | Levels 3/4 prove the BE and the DB. Neither touches the **FE**, and the claim is a three-layer one: everything between the D1 result set and the pixels (JSON serialisation, the client render loop, any sort in template JS) is unproven below this level. Bought deliberately small — 2 cases, no filter permutations, no cross-browser matrix, no per-endpoint sweep. Deep FE testing is gravy and expensive; this is the "some E2E", not the matrix. **If this spec grows a third case, push it down to level 4 first.** |
| 11 | Mobile Workability | **N/A** | Viewport and tap-target property (brain invariant #14). No determinism surface. |

---

## 3. What is covered, concretely

| level | file | cases |
|---|---|---|
| Unit | `tests/unit/determinism-scan.test.ts` | 20 — matched PASS/FAIL pair per scanner |
| Security (L0) | `tests/security/determinism.invariant.test.ts` | 9 — repo-wide scan, bindings, deps, no external scripts |
| Integration | `tests/integration/determinism-ordering.test.ts` | 4 — tie-seeded queries against real SQLite |
| E2E | `tests/e2e/determinism-render.spec.ts` | 2 — rendered order, repeat visit + second browser context |

Shared scanners: `tests/support/determinism-scan.ts` — three rules.

### Non-vacuity, per level

Every level asserts it actually did work, because all three failure modes below
report green:

- **Unit** — the allowlist test asserts each entry carries a stated reason, so
  the allowlist cannot be widened into a no-op.
- **L0** — anchors that `src/handlers/dj.ts` and `catalog.ts` were in scope and
  that >30 files were scanned. A scan over zero files trivially passes.
- **Integration** — seeds 25 tracks on a total tie and asserts exactly 10 come
  back, so an empty result set cannot pass.
- **E2E** — seeds its own 4 tracks via the import API and asserts a non-empty
  list. The first draft relied on ambient catalog state and skipped when empty;
  it passed locally only because an earlier full-suite run had left 4 rows
  behind, and would have skipped green in clean CI. Fixed to self-seed.

### Rule 1 — `ORDER BY` resolves ties

SQLite guarantees no order among rows with equal sort keys. Worst with `LIMIT`:
a tie at the cutoff makes a row appear or vanish between two identical requests.
A final sort term qualifies as unique when it is an `id` column, or is listed in
`UNIQUE_BY_CONSTRUCTION` **with a stated reason** (e.g. `decade` — one row per
decade under `GROUP BY`). *The allowlist is the documentation.*

### Rule 2 — randomness only mints identifiers

`crypto.randomUUID()` and `getRandomValues()` are permitted and widespread —
session tokens, PKCE verifiers, CSP nonces, new row ids. That randomness never
reaches a query result or a rendered list. `Math.random()` and
`ORDER BY RANDOM()` are forbidden outright.

### Rule 3 — no inference in the request path

No model SDK, Workers AI binding, embedding call, or inference endpoint in the
Worker or the templates. Comments are exempt — prose naming a vendor is not a
call. Also gated: no AI runtime dependency, no `[ai]` binding, and **no external
`<script src>`** in any template, so nothing can pull a model client at runtime.

---

## 4. Proof the gates are born red

Every rule was demonstrated failing before its green run counted. These are
automated at level 3, so they re-run on every PR rather than living here as a
claim:

| broken fixture | expected |
|---|---|
| `ORDER BY attribution_count DESC LIMIT 10` | flagged — the leaderboard failure mode |
| `ORDER BY t.artist ASC, t.name ASC` | flagged — leading terms precise, final term ties |
| `Math.random()` | flagged |
| `ORDER BY RANDOM()` | flagged |
| `import Anthropic from '@anthropic-ai/sdk'` | flagged |
| `env.AI.run(...)` | flagged |
| `fetch('https://api.openai.com/...')` | flagged |

The last case **found a real defect on first run**: the scanner's comment
stripper (`//.*$`) was eating `https://` at the scheme slashes, blinding it to
exactly the endpoints it existed to catch. A pass-only gate would have shipped
that blindness silently. This is the concrete argument for the rule in §1.

---

## 5. Findings this gate produced (2026-08-30)

**14 tie-unstable queries fixed** across 5 handlers — tiebreakers appended, no
schema change, no response-shape change:

- `dj.ts` DJ top-tracks · `events.ts` event leaderboard · `sponsor.ts` sponsor
  report + DJ breakdown — all `attribution_count DESC LIMIT n`. For a product
  where **DJ credit is the point**, a leaderboard that reshuffles on ties is a
  correctness defect, not a cosmetic one.
- `catalog.ts` contributor lists, playlists, top genres, brand rollups.
- `export.ts` CSV/JSON export ordering.

**Already deterministic, left alone** — verified rather than assumed:
pagination (`catalog.ts` sorts by unique `t.id`; `cursor.ts` uses keyset
pagination on it, so no page can skip or duplicate a row), and the `decade` /
`hour` / `source_platform` sorts, whose sort key *is* their `GROUP BY` /
`DISTINCT` key.

---

### 5.1 Adjacent finding — dead rate limiter (not a determinism defect)

Running the new E2E spec surfaced this in the worker log:

```
RATE_LIMIT_ERROR: KV PUT failed: 400 Invalid expiration_ttl of 59.
```

`src/lib/rate-limit.ts` wrote `expirationTtl` as the *remaining* window. Every
bucket uses a 60s window, so the moment the window began elapsing the TTL fell
below Cloudflare KV's 60s minimum, the PUT was rejected, **the counter never
persisted, and the limiter never tripped** — auth, import, and api buckets
alike. A live security control, silently dead in production.

Two lessons, both recorded because they generalise:

1. **The mock was more permissive than the platform.** `createMockKV().put`
   ignored its options, so the unit suite was green while real KV rejected every
   write. The mock now enforces the 60s floor. *A mock that cannot fail the way
   production fails is a rubber stamp, not a test double.*
2. **The first regression test was falsely green.** Two calls in the same
   millisecond both compute a full 60s window and round to exactly 60, hiding
   the bug. It only reproduces once time advances. The test now uses fake timers
   — and was confirmed born red (8 pass with the fix, 2 fail without). *A
   born-red proof that does not actually go red is worth less than no proof,
   because it manufactures confidence.*

This belongs in its own commit/PR — it is a security fix, not a determinism one.

## 6. Promotion criteria

This gate is static + integration today. It becomes fully live when:

1. A deployed-worker check confirms two identical requests to
   `/api/djs/:id` and `/api/events/:id/music` return byte-identical ordering
   against staging (extends `scripts/smoke.mjs`).
2. The rules are registered centrally in the brain
   (`OCR-docs/ocr-docs-brain/architectural-invariants.yaml`) so they bind OSE
   and OAW too, rather than living as a per-repo gate. Determinism is an
   org-level property; today only WKRP enforces it.

---

## 7. Known divergence

The test files here follow the repo's existing convention
(`determinism-scan.test.ts`), not `OCR_STANDARD_testNaming`'s
`{Product}_{TestType}_{What}_{How}_{Why}.test.ts` spine. The whole existing OW
suite diverges the same way; renaming three new files would make them the odd
ones out. Recorded as pre-existing drift for a repo-wide rename, deliberately
not fixed piecemeal here.
