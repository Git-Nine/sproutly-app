# PROJ-13: Survival Confidence Band

## Status: Architected
**Created:** 2026-07-10
**Last Updated:** 2026-07-10

## Dependencies
- Requires: PROJ-6 (Rule-Based Plan Generation) — the hard filters, ranking, and plan snapshot the band is derived from
- Requires: PROJ-7 (Plan Review & Acceptance) — the plan view and add-plant picker where the band surfaces
- Soft: PROJ-4 (Environmental Data Enrichment) — soil/zone/rainfall/location-basis inputs; the band degrades honestly when enrichment is partial
- Soft: PROJ-11 (Plant Catalogue ETL) — the `moisture` trait and `ai_origin_fields` verification tracking used as band inputs

## Context

The PRD listed a numeric "Survival Confidence Score" as a v2 non-goal because a calibrated percentage needs garden-centre stock data and real survival outcomes — neither exists. This feature is the reframed, honest v1: a **deterministic, banded confidence indicator** computed from data the app already holds. No AI generates the band, no percentage is shown, and every band is always accompanied by its reasons. Percentages stay out until PROJ-9 outcome data can calibrate them.

It serves the PRD's core personas directly: Maya needs one glanceable reassurance signal ("will my garden make it?"); Thomas needs the evidence behind it. It also supports the trust metric (support contacts about trust < 5% of active users): the band never claims precision the data can't back.

## The Band Model (product definition — exact wording/visuals are design's)

**Scale — 3 bands, reason-led. Every band is always displayed with its reasons.**

| Band | Meaning |
|------|---------|
| **High confidence** | Passed all hard filters; no known mismatch; no un-offset data gap |
| **Good match** | Passed all hard filters; one un-offset data gap (we know a little less about this site or plant) |
| **Worth checking** | A known survivability mismatch (soil or moisture conflict), or two or more data gaps |

**Every recommended plant already passed the hard sun/zone/fit filters, so no band ever reads as "likely to die."** "Worth checking" signals extra care or a data gap — its reason text must make that explicit.

**Downgrade factors (per plant):**
- *Known mismatches (heavy — force "Worth checking", cannot be offset):*
  - (a) Soil mismatch — the site's confirmed soil is not in the plant's `soil_compatibility` (the existing `soilFlag`)
  - (d) Moisture conflict — the plant's `moisture` trait conflicts with the site's rainfall level
- *Data gaps (mild — one gap = "Good match" unless offset):*
  - (b) Site soil unknown (enrichment `soil_status` ≠ success)
  - (c) Hardiness zone unconfirmed
  - (e) Plant has survival-critical traits still AI-inferred and unverified (`ai_origin_fields` non-empty)
  - (f) Site location derived from postcode centroid rather than GPS

**Boost factors (offset only, never penalize):** `native = true` or maintenance level matching the user's preference each offset **one** mild data gap ("locally adapted, so we're confident despite the gap"). Boosts can never offset a known mismatch, never raise above "High confidence", and a non-native or maintenance-mismatched plant with clean data still shows "High confidence" — no plant is penalized for what it isn't.

**Missing plant traits are skipped, not punished:** a hand-seeded plant with `moisture = null` simply isn't evaluated on moisture (human-curated coverage gap ≠ suspect data). `ai_origin_fields` non-empty is different — that positively marks unverified AI guesses, and does downgrade.

**Plan-level headline — majority + exception callout:** the headline band is the band most plants in the plan hold, with lower-band plants explicitly counted next to it (e.g. "High confidence — 9 of 11 plants; 2 worth checking below"). Outliers are named, never hidden; one unverified catalogue entry can't paint the whole plan as risky.

**Ranking (PROJ-6 engine change, ranking-only):** the per-plant band becomes the **first** ranking criterion within each layer, ahead of the existing native → soil-match → maintenance-match → compact → name tiebreaks. The hard filter set (sun/zone/fit) is **unchanged** — no plant is excluded by this feature. The moisture *hard* filter remains its own separate PROJ-6 follow-on, as already planned in INDEX.md.

## User Stories

- As **Maya (Guilty Non-Starter)**, I want one clear confidence signal on my plan so that I can accept it without researching every plant myself.
- As **Maya**, I want to see *why* the app is confident (or isn't) in plain words so that the reassurance feels earned, not decorative.
- As **Thomas (Pragmatic Rockery Defender)**, I want the confidence signal backed by checkable facts (sun, soil, climate match) so that I can trust the plan on evidence rather than green marketing.
- As an **experienced gardener** editing my plan, I want confidence bands in the "more plants that suit your space" picker so that I can swap plants informed and see the plan's headline band react.
- As a **user whose site enrichment is incomplete** (no soil data, unconfirmed zone), I want the band to say honestly that we know less about my site — not pretend certainty — so that I'm not misled.

## Out of Scope

- **Calibrated percentages / numeric scores** — deferred until PROJ-9 (Progress Photo Log) provides real survival-outcome data to calibrate against. The PRD's original "Survival Confidence Score of x%" framing stays a non-goal.
- **AI-generated confidence values or reason text** — the band and its reasons are fully deterministic. AI's only relation to this feature is upstream data enrichment (PROJ-11) and the existing PROJ-12 rationale prose, which is separate.
- **Moisture as a hard filter** (excluding plants from the survivor pool) — stays the separate PROJ-6 follow-on already noted in INDEX.md. This feature uses moisture for banding/ranking only.
- **Bands on the shopping list (PROJ-8)** — a "worth checking" chip at purchase time reads as a warning not to buy, hurting the plan→order metric. Excluded from v1.
- **Bands on My Spaces scan cards** — no room for the reasons that make the band trustworthy; excluded from v1.
- **Bands in the admin plant list** — admins have `ai_origin_fields` tooling from PROJ-11 already.
- **Garden-centre stock quality as a band input** — requires the garden-centre API integration (PRD v2 non-goal).
- **Feeding bands into the PROJ-12 AI curator prompt** — logged as an open question / follow-on; curation behavior is unchanged in v1.
- **Push/in-app notification when a plan's band changes** — PROJ-10 territory, and bands only change on regenerate/edit anyway.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Band display
- [ ] Given a generated plan with full enrichment (soil success, zone confirmed, GPS basis), when the user views the plan, then a plan-level headline band is shown near the plan intro and every plant line shows its per-plant band.
- [ ] Given any band is displayed (plan-level or per-plant), when the user views it, then its reasons are visible with it (directly or via one tap), phrased in plain, non-technical language, and only factors that were actually evaluated are listed.
- [ ] Given all of a plan's plants pass with no mismatches and no data gaps, when the user views the plan, then the headline reads "High confidence" with reasons naming the matched factors (sun, soil, climate).
- [ ] Given a plan where most plants are "High confidence" and 2 are "Worth checking", when the user views the plan, then the headline shows the majority band plus an explicit exception count (e.g. "9 of 11 plants; 2 worth checking"), and the 2 plants are identifiable in the list.
- [ ] Given a plant with a soil mismatch (`soilFlag`), when its band is computed, then it is "Worth checking" regardless of native/maintenance boosts, and the reason names the soil conflict and what to do about it (e.g. soil preparation).
- [ ] Given a plant whose moisture trait conflicts with the site's rainfall level, when its band is computed, then it is "Worth checking" with a moisture-specific reason.
- [ ] Given a site with unknown soil and a native plant, when that plant's band is computed, then the native boost offsets the single data gap and the plant shows "High confidence" with a reason noting it is locally adapted.
- [ ] Given a non-native, maintenance-mismatched plant with no mismatches and no data gaps, when its band is computed, then it shows "High confidence" (absence of boosts never penalizes).
- [ ] Given a plant with non-empty `ai_origin_fields` and one further data gap and no applicable boost, when its band is computed, then it shows "Worth checking" (two data gaps).
- [ ] Given a hand-seeded plant with `moisture = null`, when its band is computed, then the moisture factor is skipped entirely — it counts as neither a gap nor a match.
- [ ] Given any band or reason text anywhere in the feature, when it is displayed, then it contains no percentage, no numeric score, and no word promising a guarantee.

### Ranking
- [ ] Given two plants in the same layer with different bands, when a plan is generated, then the higher-band plant ranks (and is selected) ahead of the lower-band plant, with the existing native → soil → maintenance → compact → name order as tiebreak within a band.
- [ ] Given the band-led ranking, when plans are generated across the full site matrix, then zero hard-constraint violations occur (the existing PROJ-6 guardrail suite passes unchanged) and no plan becomes empty that wasn't empty before (hard filters untouched).

### Editing & picker
- [ ] Given the user opens the "more plants that suit your space" picker, when the list renders, then each candidate plant shows its per-plant band for this site.
- [ ] Given the user adds or removes a plant, when the plan updates, then the plan-level headline band and exception count recompute immediately and consistently with the per-plant bands.

### Honest degradation
- [ ] Given a scan with failed/partial enrichment (soil unavailable AND zone unconfirmed), when the user views the plan, then the headline band reflects the data gaps, the reasons say plainly that less is known about this site, and the existing enrichment-retry path remains reachable.
- [ ] Given a plan created before this feature shipped, when the user views it, then bands are shown, computed from the data that plan's snapshot actually holds — factors whose data was never captured are skipped, not guessed.
- [ ] Given a PROJ-12 curated plan (or its silent rule-engine fallback), when the user views it, then bands are computed identically on the final plan lines regardless of whether curation succeeded — the band never depends on the AI path taken.

## Edge Cases

- **Empty plan (no survivors):** no bands are shown; the existing empty-plan messaging stands alone. A band on nothing is noise.
- **All plants share the same band because of a site-wide gap** (e.g. soil unknown downgrades everything): the headline reason must attribute this to the *site data*, not the plants ("we couldn't confirm your soil type"), so 11 identical "Good match" chips don't read as 11 mediocre plants. Per-plant reasons may then omit the repeated site-level factor if the headline carries it.
- **Pinned plants during rebalance:** pinning affects quantities, never bands. A pinned "Worth checking" plant stays "Worth checking" — the user's choice is respected in the plan and reflected honestly in the headline count.
- **Plant deleted from the catalogue after plan creation:** PROJ-6's reassign-and-delete flow already replaces it; the replacement is banded like any other line. No special state.
- **Conflict with PROJ-12 rationale prose:** the AI rationale ("why this one") and the deterministic band reasons coexist on a line. If they disagree on a survival claim, the deterministic band is the authoritative display; rationale is flavour. (The curator prompt update to prevent contradictions is an open question below.)
- **Regeneration after this ships produces a different plan for the same site** (ranking changed): expected and accepted. Persisted plans do not change on their own; only explicit Regenerate/edit actions produce the new ordering. PROJ-7's existing staleness handling covers the messaging.
- **Zone unconfirmed** already suppresses the zone hard filter (PROJ-6); for banding it counts as a data gap on every plant, surfaced at headline level like the site-wide soil case.
- **Rainfall data unavailable** (climate_status ≠ success): the moisture factor is skipped for all plants (no site value to compare against) — skipped, not counted as a per-plant gap, since the gap is site-level and already reflected via the enrichment-driven factors.

## Technical Requirements (boundaries only — design is /architecture's)
- The band computation must be pure and deterministic (same inputs → same band), unit-testable, and shared by every surface that renders a band (plan view, picker, headline) so surfaces can never disagree.
- Band inputs that come from the site must come from the plan's stored snapshot (consistent with how PROJ-7 keeps stale plans honest); the snapshot will need to carry the additional site facts the band needs (e.g. rainfall level, location basis) for newly generated plans.
- The PROJ-6 guardrail suite (252-site matrix, zero violations) must pass with band-led ranking enabled.
- No new external APIs, no AI calls, no new user-facing latency: banding is a local computation.
- Wording ships in the app's existing language conventions; no percentages, no "guarantee".

## Open Questions
- [ ] Should the PROJ-12 curator prompt receive per-plant bands (and be instructed not to contradict them in rationale prose)? Follow-on candidate; v1 keeps curation unchanged.
- [ ] Should "Worth checking" reasons link to the plant's `care_notes` (e.g. soil-preparation guidance) or stay self-contained text? Leaning link-if-notes-exist; decide at /frontend.
- [ ] Exact visual treatment (chip vs. inline text, iconography, colour semantics within the design system) — design decision at /frontend; colour must not be the only carrier (a11y).
- [ ] When PROJ-9 ships and outcome data accumulates: what volume/duration is needed before a calibrated numeric score becomes defensible? Research question, out of v1.
- [ ] Exact rainfall bucket thresholds (mm/year for low / medium / high) — set at /backend against real DWD value ranges for Germany (~450–2000mm); must be named constants with a comment citing the source.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Banded indicator, no percentages, no AI-generated numbers | No outcome data exists to calibrate a % against; a fabricated number is a trust liability (PRD trust metric < 5%). Bands + reasons are honest and still glanceable. AI stays in the data-enrichment role only. | 2026-07-10 |
| Both plan-level headline and per-plant bands; headline derived from per-plant bands | Maya needs one glance; per-plant explains why and names outliers. Deriving one from the other makes contradiction impossible. | 2026-07-10 |
| 3 bands, reason-led ("High confidence" / "Good match" / "Worth checking") | Two bands degenerate to decoration; 5+ or numeric implies false precision. Reasons carry the trust, the band carries the glance. Lowest band must never read as "likely to die" — everything shown passed hard filters. | 2026-07-10 |
| Band inputs include native + maintenance fit (user choice, deviating from survival-only proposal) | Native = locally adapted is a genuine mild survival plus; maintenance fit predicts neglect risk. | 2026-07-10 |
| …but as boosts only, never penalties | A boost can offset ONE mild data gap and never a known mismatch; absence of a boost never downgrades. Prevents every non-native plant visibly carrying a "risk" mark, which would misread as survivability and clash with native-first ranking. | 2026-07-10 |
| Band feeds engine ranking (user choice, deviating from display-only proposal) | Band-first ranking within layers makes the displayed confidence and the engine's actual preference coherent — the plan visibly practices what the band preaches. | 2026-07-10 |
| …but ranking-only: hard filters unchanged | No plant is excluded by this feature; small sites keep full plans; guardrail semantics stay valid; the moisture hard filter stays the separate PROJ-6 follow-on per INDEX.md. | 2026-07-10 |
| Headline = majority band + explicit exception count | Weakest-link lets one unverified catalogue row paint a whole plan as risky (anti-reassurance); majority-with-callout reassures without hiding outliers. | 2026-07-10 |
| Surfaces: plan view + add-plant picker only | Editing without bands would let users swap in low-confidence plants blind and see the headline change "for no reason". Shopping list excluded (a warning chip at purchase time hurts the plan→order metric); My Spaces excluded (no room for reasons). | 2026-07-10 |
| Missing plant trait (e.g. moisture null on hand-seeded rows) is skipped, not downgraded; non-empty `ai_origin_fields` IS downgraded | Human-curated rows with a coverage gap ≠ rows with positively unverified AI guesses. Punishing the former would drop ~40 hand-seeded plants a band for no survivability reason. | 2026-07-10 |
| Mismatches (soil/moisture conflict) are un-offsettable and force "Worth checking" | A known conflict is qualitatively different from a data gap; letting boosts mask it would be the dishonesty this feature exists to avoid. | 2026-07-10 |
| Existing plans get bands computed from whatever their snapshot holds; missing factors skipped | Honest for old data without migration/backfill; "never guess" is the feature's core principle. | 2026-07-10 |

### Technical Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| One new pure module owns all band logic; engine imports it, UI renders its output | The spec's "surfaces can never disagree" requirement enforced by construction; mirrors the plan engine's proven pure-module pattern; testable without UI or DB. | 2026-07-10 |
| Bands are computed, never persisted | Recomputing from snapshot + current catalogue means curator corrections improve existing plans' bands automatically; no stale stored band, no backfill, no extra writes on every edit. | 2026-07-10 |
| Two new nullable snapshot columns on `plans` (rainfall, location basis) — not a JSON blob, not a new table | Matches the existing typed `snapshot_*` column pattern; nullable = old plans skip those factors, so "never guess" falls out of the schema. Additive, no RLS change. | 2026-07-10 |
| Store raw rainfall mm in the snapshot; bucket into low/medium/high at read time behind named constants | Thresholds are interpretation, not data — tuning them later must not require touching stored plans. Only opposite extremes (dry↔high, wet↔low) count as a conflict: conservative, avoids false alarms from mid-range values. | 2026-07-10 |
| Reasons returned as machine-readable codes; UI owns the copy | Wording iterations (and the no-%/no-"guarantee" rule) live in one display layer; the calculation stays wording-free and the codes are directly assertable in tests. | 2026-07-10 |
| Band as first sort key in the existing per-layer ranking; previous order becomes the tiebreak | Smallest possible engine change that satisfies "the plan practices what the band preaches"; hard filters untouched so the guardrail suite's semantics stay valid. | 2026-07-10 |
| Per-plant traits read live from the catalogue, not snapshotted | The plan view already loads plant rows; snapshotting traits would freeze errors a curator later fixes. Site facts snapshot (honest history), plant facts live (honest present). | 2026-07-10 |
| Module reused isomorphically server-side (generation ranking) and client-side (live recompute on edit) | Pure + dependency-free makes this free; avoids an API round-trip per edit and keeps the picker instant. | 2026-07-10 |
| Backend built before frontend for this feature | The migration, module, and ranking change are fully testable headless; the UI is a thin renderer of module output. | 2026-07-10 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_Added 2026-07-10 by /architecture._

### The one-sentence design
One new, pure "confidence" calculation module is the single source of truth for every band anywhere in the app; the engine consults it for ranking, the plan view and picker consult it for display, and two small nullable additions to the plan snapshot give it the site facts it doesn't have yet — no new APIs, no new packages, no AI.

### Component Structure

```
Plan view (existing PlanEditor / PlanBuilder screens)
+-- "Why this plan" intro area (existing, PROJ-12)
|   +-- NEW: Plan Confidence Headline
|       +-- majority band + exception count ("High confidence — 9 of 11 plants; 2 worth checking")
|       +-- headline reasons (site-level: soil confirmed? zone confirmed? GPS or postcode?)
+-- Plant line (existing, one per recommended plant)
|   +-- NEW: Per-plant Confidence Badge
|       +-- band chip + tap/expand for plain-language reasons
|       +-- (sits alongside the existing PROJ-12 "why this one" rationale text)
+-- "More plants that suit your space" picker (existing)
    +-- NEW: same Confidence Badge on every candidate row
```

Both new UI pieces are thin: they render whatever the shared calculation module returns. Neither computes anything itself — that's how the headline, the line badges, and the picker can never disagree.

### The Confidence Module (new, heart of the feature)

A single new calculation module (`plan confidence`, alongside the existing plan engine) that:
- takes one plant's traits + the plan's site snapshot, and returns **a band plus a list of reason codes** (machine-readable codes like "soil-mismatch" or "zone-unconfirmed" — the UI translates codes into friendly copy);
- aggregates per-plant bands into the **headline** (majority band + exception counts);
- owns the **rainfall-vs-moisture comparison**: the snapshot's raw annual rainfall is bucketed into low / medium / high behind named, documented thresholds, and only *opposite extremes* conflict (a dry-loving plant on a high-rainfall site, or a wet-loving plant on a low-rainfall site). Middle ground never conflicts — conservative by design.

Like the plan engine, it is pure and deterministic: same inputs, same band, no I/O, no dates, no randomness — fully unit-testable, and it runs identically on the server (generation) and in the browser (live recompute while editing). Reasons live as codes, not sentences, so wording changes never touch the calculation and the "no percentages, no guarantee" rule is enforced in one copy layer.

### Engine Change (ranking only)

The engine's per-layer ranking gains the band as its **first** sort key, ahead of the existing native → soil → maintenance → compact → name order (which becomes the tiebreak within a band). The hard filters are untouched — the engine imports the confidence module, never the reverse. The 252-site guardrail suite must pass unchanged, plus a new test asserting a higher-band plant outranks a lower-band one in the same layer.

### Data Model (plain language)

**Two new optional fields on the plan snapshot** (the `plans` table, alongside the seven existing snapshot fields):
- **Rainfall** — the site's annual rainfall (raw millimetres) at generation time. Stored raw, bucketed at read time, so tuning the thresholds later never requires touching stored plans.
- **Location basis** — whether the site location came from GPS or a postcode centroid.

Both are nullable: plans created before this feature simply have neither, and the module skips those factors — "never guess" falls out of the schema. One additive migration, applied via the dashboard SQL Editor (this project's established practice). **Nothing else is stored** — bands and reasons are always recomputed from snapshot + current plant data, never persisted, so a catalogue correction (e.g. a curator verifying an AI-inferred trait) improves existing plans' bands automatically.

**Per-plant inputs come live from the catalogue** (soil compatibility, moisture, native, maintenance level, AI-origin markers) — the plan view already loads this data for display today; no new query.

### What does NOT change
- No new API routes, no new packages, no AI/n8n involvement, no RLS changes (the new columns live on `plans`, already owner-scoped).
- PROJ-12 curation is untouched; bands are computed on the final plan lines regardless of whether curation ran. (Ranking does change the menu order the curator sees — accepted, logged.)
- The persisted per-line `soil_flag` stays for compatibility, but the module re-derives soil match itself from the snapshot so the band never depends on a stored flag.

### Dependencies
None — everything is built with what's already installed.

### Build order
1. **/backend first** (unusual but right here): migration + confidence module + engine ranking change + snapshot persistence — all testable without UI.
2. **/frontend second**: headline + badge + picker wiring, copy for reason codes.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
