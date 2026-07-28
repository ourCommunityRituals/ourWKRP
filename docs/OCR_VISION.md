# OCR_VISION — OurWKRP (OW)
## Product vision — derived from the org-level source of truth

> Derived from `ourCommunityRituals/OCR-docs/docs/OCR_VISION.md` (org source of truth).
> Where this doc and the org doc disagree, **the org doc wins and this gets fixed.**
> Where this doc references invariants, the source of truth is code — see
> **`docs/OCR_GATE_triangleConformance.md`** for OW's per-invariant status.
>
> **Status: DRAFT** — seeded 2026-06-09 by Co-Architect, awaiting review. **Owner: Matt.**
> This is one of the four governance files (§6.3): `CLAUDE.md` · `docs/OCR_VISION.md` ·
> `README.md` · `SKILL.md`.

---

## 1. North star
The org north star holds: the person at the bus stop on Western Avenue at 7am.
OW's role in that picture — **human music curation as a cultural stand**: named
people, voluntary attribution, generational lineage. Not a playlist tool.

## 2. What OW is (org §7)
OurWKRP — community music curation. **Named identity. Free, community-based — a
cultural statement, not a revenue product.** Same architecture as OSE, **separate
database.** Music is the starting medium; architecturally extends to all arts.

## 3. Platform symmetry — OW is OSE's named mirror (org §6.5)
OSE and OW are parallel platforms with **opposite identity invariants**, sharing
architecture and brand but **not databases**.

| | OSE (Group) | OW (Individual) |
|--|--|--|
| Identity | Anonymous ID — no PII (Invariant 1) | **Named identity — voluntary attribution** |
| Database | Separate | Separate |
| Funding | Sponsor model | Free, community-based |
| Posture | Operational platform for events | Cultural statement, music first, all arts capable |

The **Choice network is the pair**: at OSE you're an anonymous attendee (Group); at
OW you're an identified presenter *or* an anonymous/untracked attendee (Individual).
"Converge under the OCR moniker" = shared architecture + brand, **not merged data.**

## 4. OW specifics (org §7)
- **Fists of 5** — five-person teams competing through music.
- **DJ layer** — DJs lead Fists of 5 teams; each DJ has a personal profile, deployed
  through OA (front of the flywheel = single-person white-label).
- **QR referrals → SharedReports** — DJs display QR during sets; codes can be
  **anonymous** (route to OSE-style reporting) or **named** (stay in OW). Per-code choice.
- **Anchors / venue targets** — Primary: **RIPH**. White-label: Reckless Records,
  Smart Bar, Hyde Park Records.

## 5. Data → OER (org §6.6)
OW emits **named curation data — voluntary attribution only** to OER (the BigQuery RAG).
A field qualifies only if **named-with-explicit-voluntary-attribution** (OW-class).
Listener identities never cross the boundary; only the contributor's voluntary attribution.

## 6. Architecture & invariants
OW plugs into the Triangle by passing the **applicable** architectural invariants
(org §6.2). OW's Invariant-1 form is the **named/voluntary mirror** of OSE's Anonymous ID.
Current per-invariant status, the gaps, and the prioritized road to parity live in
**`docs/OCR_GATE_triangleConformance.md`**.

---
*Seeded 2026-06-09 from org `OCR_VISION.md` (v2, 2026-04-14). DRAFT — awaiting Matt's review.
Nothing here is invented; every claim derives from the org doc, `CLAUDE.md`, or verified code.*
