# OCR_GATE — OurWKRP Triangle Conformance

> **Gate.** A product personality plugs into the Triangle by *passing the applicable
> architectural invariants* (org `OCR_VISION.md` §6.2: *"a new product personality —
> OW, future verticals — must pass these to plug into the Triangle"*).
>
> - **Registry source of truth:** `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
>   — **14 invariants** (#1–#14) as of 2026-06-09.
> - **Enforcement source of truth:** code + facet tests. This doc mirrors that; when
>   they disagree, the code wins and this gets fixed.
> - **Status:** living. Last assessed 2026-06-09.

---

## Definition of done (parity)

OW is "at parity with OSE" when it is **conformant on every *applicable* invariant,
with the Choice core live** — **not 14/14** (OSE itself is not 14/14). Concretely:

- OW deployed (single-site staging → prod)
- **#1-mirror · #7 · #9 live** (the Choice core + white-label)
- **#2 · #5 · #13 marked N/A** with reason
- near-done infra/mobile (**#11 · #12 · #14**) promoted to live
- **four governance files** present (§6.3)

OW is OSE's **named-identity mirror** (§6.5), not a lesser cousin: at OSE you're an
anonymous attendee (Group); at OW an identified presenter *or* anonymous/untracked
attendee (Individual). The demo shows the two poles of one Choice contract.

---

## Conformance map (registry #1–#14)

| # | Invariant | Applies to OW? | OW current state (verified 2026-06-09) | Gap | Effort |
|---|---|---|---|---|---|
| 1 | anonymous_id → **OW mirror: named/voluntary identity** | ✅ core (§6.5) | Register = identified contributor; `privacy.ts` boundary exists but uneven (events ✓, sponsor ✗, `isCrossProductRequest` dead); audit supports null actor for anon | Define the mirror invariant (named-by-voluntary-opt-in + no-cross-link) + OW facet test; finish boundary wiring | M |
| 2 | hyperlocal_geo_resolution | ❌ N/A | OSE sponsor-area matching; no OW analog | Mark N/A | S |
| 3 | uec_encoding (QR color contract) | ⚠️ if QR ships | Routes (`/live` etc.) exist; **no QR generation, no UEC hex/scan_hex in code**; registry `applies_to` omits wkrp but vision §7 says OW DJ-QR → reports | Decide QR demo scope; if yes, UEC-conformant QR gen | M–L |
| 4 | ncr_data_accumulation (scan aggregates) | ⚠️ deferred | No scan-aggregate / poster-deployment pipeline in OW | Build only if DJ-scan analytics in scope | L |
| 5 | tier_equity (sponsor pricing) | ❌ N/A | OW is free/community — no pricing tiers | Mark N/A | S |
| 6 | inert_monetization_hooks | ◑ trivial | No `X-Monetization-Inert` header; OW has no billing | Add header + assert read-only | S |
| 7 | aggregate_only_reporting | ✅ core | Boundary firewall — partially wired (same gap as #1) | Finish wiring + facet test (overlaps #1) | M |
| 8 | bounded_pii_retention | ✅ needs decision | Named PII durable *by design*; erasure on-demand (OW-83); audit 1yr purge | Decide OW retention model (voluntary-durable vs TTL'd untracked) then enforce | M |
| 9 | tenant_isolation (id+brandId) | ✅ load-bearing (white-label) | `brand_id` woven through 11 files; mechanism real | Cross-cutting facet test (dual-key) | M |
| 10 | deprecation_lock | ✅ | **LIVE** — `tests/security/deprecation-lock.invariant.spec.ts` | — | DONE |
| 11 | self_hosted_runner_bash | ✅ (all repos) | partial | Promote → live (auto-provision) | S–M |
| 12 | runner_pool_readiness | ✅ (all repos) | partial — `tests/security/runner-pool-readiness.invariant.test.ts` | Promote → live (auto-install) | S–M |
| 13 | brain_enforcement_location | ❌ N/A | `applies_to: []` — enforced centrally | None (not per-repo) | — |
| 14 | mobile_workability | ✅ | **spec + workflow both present** (`tests/playwright/mobile-workability.spec.ts`, `.github/workflows/mobile-workability.yml`) | Confirm it gates + passes every customer surface → live | S |

OW-local (not yet in central registry): `security-control-wiring.invariant.spec.ts`
(the OW-78 dormant-control facet — register centrally as ~#17 per CCR follow-up).

---

## Scorecard

- **Done/strong:** #10 (live), #14 (wired), #12/#11 (specs present) + OW-local security-control-wiring.
- **Applies, mechanism present, no conforming facet:** #1-mirror, #7, #9 — the Choice core + white-label.
- **Decision needed:** #8 (retention model for named/voluntary).
- **N/A (with reason):** #2 (geo), #5 (free → no tiers), #13 (central).
- **Scope calls:** #3 (UEC QR), #4 (scan aggregates), #6 (monetization-inert, trivial).

---

## Roadmap to parity — prioritized

**Sequenced behind the single-site staging launch** — you can't demo undeployed OW,
so staging is the runway, not a rival to this work.

### P0 — prerequisite
- **Ship single-site staging.** Cloudflare custom domain (`stg.ourwkrp.com`) →
  `npm run deploy:staging` → walk one real OAuth login.

### P1 — Choice core (demo-critical arc, ~2 sprints)
- **Story OW-INV1 — named-identity mirror + cross-product boundary (#1-mirror + #7)**
  - encode the brain invariant (named/voluntary attribution + no-cross-link), `applies_to: [..., wkrp]`
  - finish `privacy.ts` wiring: `handleSponsorReport` + `handleExportTracks` strip; replace dead `isCrossProductRequest` with a uniform cross-product gate
  - OW facet test — L0 static (every cross-product handler strips listener PII) + L1 integration (cross-product response carries zero listener PII)
- **Story OW-INV9 — tenant isolation facet (#9)**
  - cross-cutting dual-key (`id`+`brandId`) assertion across multi-tenant tables; audit-query brand-scoping

### P2 — promotions (mop-up, near-done)
- **#14** mobile_workability → confirm workflow gates + passes → live
- **#11/#12** runner invariants → auto-provision/install → partial → live

### P3 — scope decisions
- **#3 / #4** (UEC QR / scan aggregates) — only if DJ-QR analytics is in the demo

### N/A — record with reason
- **#2** geo (OSE sponsor matching) · **#5** tier equity (OW free) · **#13** brain-location (central audit)

---

## Tracked doc fixes
- Seed `docs/OCR_VISION.md` — **done 2026-06-09** (closes §6.3 four-files: 3/4 → 4/4).
- Org `OCR_VISION.md` §6.2 lists **10** invariants; registry is **14** — refresh the
  table (brain PR in `OCR-docs`, separate repo).

---
*Assessed 2026-06-09. Owner: Matt. This is the living parity plan for OW.*
