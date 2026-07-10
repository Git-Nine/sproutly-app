# PROJ-15: Biodiversity Indicator

## Status: Planned
**Created:** 2026-07-10
**Last Updated:** 2026-07-10

## Dependencies
- Requires: PROJ-14 (Ecological Trait Enrichment) — the verified per-species ecological data (wildlife value, bloom months, pollinator flag) this indicator reads
- Requires: PROJ-7 (Plan Review & Acceptance) — the plan view where the indicator surfaces
- Soft: PROJ-13 (Survival Confidence Band) — shares the banded-honesty display convention and likely the reason-card layout

## Context

The PRD deferred "biodiversity scoring" as "unvalidated, research first," and any "increased by x%" framing has no defensible baseline (gravel ≈ zero, so any percentage is arbitrary). This feature is the honest v1: a **deterministic, banded, concrete** biodiversity indicator on the plan view, computed from PROJ-14's verified ecological data. It answers the emotional question behind Sproutly's mission — "does my garden actually help?" — with checkable facts rather than a fabricated number.

It serves both personas: Maya gets affirmation that her single decision matters ("this supports pollinators and birds"); Thomas gets the concrete evidence (species count, bloom months) that beats a green slogan. And it directly dramatizes the hardscape-to-garden conversion the PRD is built around.

## The Indicator (product definition — exact wording/visuals are design's)

**Plan-level, on the plan view.** Two coordinated parts:

1. **A band** — ordinal, e.g. "Rich for wildlife" / "Good for wildlife" / "A start", matching PROJ-13's banded-honesty convention. The lowest band is encouraging, never discouraging (a first planting is still infinitely more than gravel).
2. **A concrete claim built from real data** — e.g. *"Supports pollinators and birds, and blooms about 7 months of the year (March–September)."* Optionally a plain, factual contrast: *"Gravel supports effectively none."* No fabricated percentage, no numeric score.

**Computed from three deterministic sub-factors (PROJ-14 data):**
- **Wildlife support** — aggregate of insect/pollinator value + bird value across the plan's plants.
- **Species richness** — distinct species in the plan (the engine already targets this).
- **Bloom-season coverage** — how many months of the year at least one plant is in flower (bloom start/end, wrap-aware per PROJ-14).

Each sub-factor contributes a distinct phrase to the concrete claim and degrades independently if its data is missing.

**Verified data only.** The band and claims count **only human-verified** ecological traits (PROJ-14 provenance). AI-inferred-but-unverified traits are treated like missing data — they count toward coverage, never toward the score. Every user-facing biodiversity claim rests only on checked data.

**Honest partial coverage.** The band is computed from the plants that have verified data, with coverage disclosed ("based on 6 of your 8 plants"). Below a minimum coverage threshold, a neutral "we're still building this insight for your plan" state shows instead of a potentially misleading band. Null ecological data is never counted as zero.

## User Stories

- As **Maya (Guilty Non-Starter)**, I want to see that my plan genuinely supports wildlife so that my single decision feels like it mattered — the affirmation the whole journey is for.
- As **Thomas (Pragmatic Rockery Defender)**, I want concrete, checkable facts (how many species, how many months of bloom, pollinators vs. birds) so that the biodiversity claim reads as evidence, not a green slogan.
- As **any user comparing to their current gravel/paved space**, I want a plain factual contrast so that the value of converting is obvious without being lectured.
- As **a user whose plan's ecological data is incomplete**, I want the indicator to be honest about what it's based on so that I trust it rather than suspecting inflation.
- As **the product**, I want the indicator to make no claim that isn't backed by human-verified per-species data so that it survives scrutiny and protects the trust metric.

## Out of Scope

- **Percentages / "+x% biodiversity" framing** — no defensible baseline (gravel ≈ zero); indefensible precision. The reframed honest version is this feature.
- **A numeric 0–100 biodiversity score** — implies precision the ordinal source data can't back.
- **Using AI-inferred-but-unverified traits in the score** — verified-only; the whole PROJ-14/15 split exists to prevent an unverified claim reaching a user-facing number.
- **The ecological data pipeline itself** — that's PROJ-14. This feature only reads verified data.
- **Larval-host / named-species claims** — depend on PROJ-14 out-of-scope data; later extension.
- **Biodiversity on the shopping list, My Spaces, or admin** — plan view only in v1 (same reasoning as PROJ-13: purchase-checklist and card surfaces lack room for the honest context).
- **Changing plant selection to maximize biodiversity** — the engine is unchanged; this indicator describes the plan, it doesn't reshape it. (A "boost biodiversity" engine mode is a possible later feature.)
- **Historical/seasonal tracking of a space's biodiversity over time** — belongs with PROJ-9 progress logging, not here.
- **Calibrated ecological outcome claims** ("attracts N bees") — needs field data the app doesn't have.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Display
- [ ] Given a plan whose plants have verified ecological data, when the user views the plan, then a plan-level biodiversity band and a concrete data-backed claim are shown.
- [ ] Given the indicator is shown, when the user reads it, then it contains no percentage, no numeric score, and no unbacked superlative; every claim traces to verified per-species data.
- [ ] Given a plan strong on wildlife value, rich in species, and blooming most of the year, when the user views it, then the top band and a claim naming pollinators, birds, species count, and bloom span are shown.
- [ ] Given the lowest band, when it is shown, then its wording is encouraging (a first step beats gravel), never discouraging.
- [ ] Given the user's space is gravel/paved (from the scan), when the indicator is shown, then the optional plain contrast to the hardscape baseline may be included, phrased factually.

### Computation
- [ ] Given the three sub-factors, when the band is computed, then it is a pure, deterministic function of the plan's verified ecological data (same plan + same catalogue data → same band), unit-testable.
- [ ] Given a plant whose ecological traits are still AI-inferred (unverified per PROJ-14 provenance), when the band is computed, then that plant's traits do not contribute to the score (treated as not-yet-assessed).
- [ ] Given a plant with a genuine "none" wildlife value, when the band is computed, then "none" is counted as a real low value, not as missing data.
- [ ] Given plants whose bloom period wraps the calendar year (e.g. Nov→Feb), when bloom-season coverage is computed, then the wrap is handled correctly (no negative or zero-length span).

### Honest partial coverage
- [ ] Given a plan where only some plants have verified data, when the indicator is shown, then the band is computed from the plants that do, and the coverage is disclosed (e.g. "based on 6 of 8 plants").
- [ ] Given a plan below the minimum verified-coverage threshold, when the user views it, then a neutral "still building this insight" state is shown instead of a band — no misleading claim.
- [ ] Given a plant with null ecological data, when the band is computed, then null is never treated as zero.

### Consistency & robustness
- [ ] Given the user edits the plan (adds/removes plants), when the plan updates, then the biodiversity indicator recomputes consistently with the new plant set and its coverage disclosure updates.
- [ ] Given a PROJ-12 curated plan or its rule-engine fallback, when the indicator is shown, then it is computed identically on the final plan lines regardless of the AI path taken.
- [ ] Given an empty plan (no survivors), when the plan view renders, then no biodiversity indicator is shown.

## Edge Cases
- **All plants unverified / no ecological data yet:** shows the neutral "building this insight" state, not a zero band.
- **Single-species plan:** richness sub-factor is honestly low; the band and wording reflect that without discouraging (still supports wildlife if that one species is high-value).
- **High-wildlife monoculture vs. diverse planting:** because richness is a distinct sub-factor, the diverse plan bands higher — diversity itself is rewarded, not just aggregate wildlife value.
- **Plan with strong wildlife value but no bloom data verified:** the wildlife claim shows; the bloom-coverage phrase is omitted rather than guessed, and coverage disclosure reflects it.
- **Coverage exactly at the threshold boundary:** the threshold behavior is defined (inclusive/exclusive) and tested so the state doesn't flicker.
- **User re-generates and plant set changes:** indicator recomputes; no stale biodiversity claim persists against a changed plan (aligns with PROJ-7 staleness handling).
- **Bloom coverage double-counting:** overlapping bloom periods across plants are unioned (months covered), not summed, so "12 months" means the year is actually covered.

## Technical Requirements (boundaries only — design is /architecture's)
- Pure, deterministic, unit-testable computation shared by the plan view and any edit-time recompute, so the displayed band can never disagree with itself.
- Reads verified ecological traits + provenance from the catalogue (PROJ-14); reads richness from the plan lines; no new external API, no AI call, no added user-facing latency.
- Minimum verified-coverage threshold is a single named constant, documented and tested.
- Wording ships in the app's language conventions; no percentages, no numeric score, colour not the sole carrier of the band (a11y).

## Open Questions
- [ ] Exact band thresholds (what combination of wildlife/richness/bloom → which band) — tuning decision at /architecture or /frontend, against the real backfilled catalogue.
- [ ] Minimum verified-coverage threshold value (e.g. ≥60% of plan plants) — decide against real PROJ-14 coverage numbers.
- [ ] Whether to show the hardscape contrast always, only for gravel/paved scans, or as a dismissible one-time nudge — /frontend decision informed by the personas.
- [ ] Whether the concrete claim links to the contributing plants (tap "blooms 7 months" → see which) — nice-to-have, decide at /frontend.
- [ ] Long-term: when PROJ-9 progress data exists, could the indicator show a space's biodiversity growing season-over-season? Research/roadmap question, out of v1.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Split from PROJ-14; this feature is display-only, reads verified data | Different user (end user vs. curator) and surface (plan view vs. pipeline); the data must be verified before any claim ships. | 2026-07-10 |
| Concrete + banded framing, no percentage, no numeric score | No defensible baseline for a % (gravel ≈ zero); ordinal source data can't back a 0–100 score; a fabricated number is a trust liability. Concrete data-backed claims persuade both personas and survive scrutiny. | 2026-07-10 |
| Band from three sub-factors: wildlife support + richness + bloom coverage | Most complete honest picture; each yields a distinct concrete phrase; richness as its own factor ensures diversity is rewarded, not just aggregate wildlife value. | 2026-07-10 |
| Verified traits only; unverified-AI treated as missing | A user-facing biodiversity claim must rest only on human-checked data — the reason PROJ-14/15 were split and the lesson of the 40%-wrong native flag. | 2026-07-10 |
| Compute on known data + disclose coverage; neutral state below a threshold; null ≠ zero | Honest with partial backfill (the launch reality); never understates a plan just because catalogue data is behind. | 2026-07-10 |
| Lowest band is encouraging, not discouraging | A first planting is infinitely more than gravel; discouraging wording would defeat the conversion mission and Maya's reassurance need. | 2026-07-10 |
| Plan view only (not shopping list / My Spaces / admin) | Same reasoning as PROJ-13: other surfaces lack room for the honest context that makes the claim trustworthy. | 2026-07-10 |

### Technical Decisions
_To be added by /architecture_

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
