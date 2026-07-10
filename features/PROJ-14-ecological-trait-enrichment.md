# PROJ-14: Ecological Trait Enrichment (ETL extension)

## Status: Planned
**Created:** 2026-07-10
**Last Updated:** 2026-07-10

## Dependencies
- Requires: PROJ-5 (Plant Database & Admin Interface) — the `plants` table these traits are added to
- Requires: PROJ-11 (Plant Catalogue ETL) — the `generate → commit → sync` pipeline, AI trait-inference + per-field confidence pattern, `source`/`ai_origin_fields` provenance, and naturadb.de curation practice this feature extends

## Context

The PROJ-15 Biodiversity Indicator needs per-species ecological data the catalogue doesn't hold — today the only ecological signal is the `native` boolean. This feature fills that gap by **extending the existing PROJ-11 ETL** to infer, verify, and store ecological traits, so the indicator can be computed deterministically from real per-species data rather than fabricated.

This is a data-pipeline / curator-facing feature. It ships and is verified **before** PROJ-15 makes any user-facing biodiversity claim. It deliberately mirrors PROJ-11's hard-won lesson: AI-inferred ecological data is a starting draft, never a live fact, until a human verifies it — the GBIF-derived `native` flag was wrong on ~40% of a fresh candidate batch, twice, and these traits will feed a persuasion metric.

## The Trait Set (product definition)

New per-species catalogue traits, all chosen because naturadb.de publishes them (so they're verifiable against the existing curation source):

| Trait | Shape | Feeds PROJ-15 |
|-------|-------|---------------|
| Insect / pollinator value | Ordinal band: none / low / medium / high | Wildlife support score |
| Bird / wildlife value | Ordinal band: none / low / medium / high | Wildlife support score |
| Bloom start month | 1–12 (nullable) | Bloom-season coverage |
| Bloom end month | 1–12 (nullable; may wrap, e.g. 11→2) | Bloom-season coverage |
| Pollinator-friendly | boolean flag | Headline claim eligibility |

Ordinal bands (not raw counts) match the app's banded-honesty convention (see PROJ-13) and avoid implying a precision naturadb.de doesn't give. "none" is a real, distinct value (e.g. wind-pollinated grasses) — different from null (not yet assessed).

## Data Trust Model (the core of this feature)

- **AI infers a draft** with a per-field confidence rating, reusing PROJ-11's `confidence` schema pattern — each ecological trait gets its own high/medium/low confidence.
- **Rows stage, never auto-commit a user-facing claim.** Low-confidence ecological traits are flagged for **mandatory curator review** against naturadb.de before commit (extending `needsMandatoryReview` / `lowConfidenceFields`).
- **Provenance is tracked.** Ecological traits still AI-inferred (not human-verified) are marked, extending the `ai_origin_fields` mechanism so a curator can target re-verification and so PROJ-15 can down-weight or caveat unverified data if it chooses.
- **Backfill of the ~160 live rows** runs through the existing `sync` step, which by design only touches `source = 'open_data_etl'` rows — hand-seeded rows (*Achillea millefolium*, *Betula pendula*) get ecological traits only by manual admin edit, never by the pipeline.

## User Stories

- As the **catalogue curator (admin/operator)**, I want the ETL to draft ecological traits with honest per-field confidence so that I only hand-verify the fields the AI is unsure about, not all of them.
- As the **curator**, I want low-confidence wildlife values flagged for mandatory review against naturadb.de before they go live so that no unverified ecological claim reaches a user-facing number.
- As the **curator**, I want the existing catalogue's ~160 plants backfilled with verified ecological traits via the sync step so that the biodiversity indicator covers most plans at launch.
- As the **curator**, I want to see which ecological traits on a row are still AI-inferred vs. verified so that I can target re-verification sessions.
- As the **PROJ-15 developer**, I want ecological traits stored in a stable, typed, nullable schema so that the indicator reads them directly and handles "not yet assessed" (null) distinctly from "no value" (none).

## Out of Scope

- **Displaying the traits to end users** — that is PROJ-15 (Biodiversity Indicator). This feature stops at verified data in the catalogue.
- **Larval-host relationships and named supported-species counts** — deferred (patchier naturadb.de coverage, higher verification burden); a later extension.
- **Raw numeric wildlife counts** — bands only, matching the app's banded-honesty convention.
- **A biodiversity score/number** — computed and shown by PROJ-15, not stored here.
- **Auto-committing unverified ecological data** — explicitly rejected; repeats the native-flag mistake on data feeding a persuasion metric.
- **Changing the plan engine (PROJ-6)** — these traits do not affect plant selection or the survival band (PROJ-13); they are ecological, not survival, signals.
- **New external ETL sources** — same open-data + AI-inference + naturadb.de-verification stack as PROJ-11; no new API dependency.
- **Fully automating naturadb.de verification** (scraping/API) — verification stays a human curator step, as in PROJ-11.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Schema & migration
- [ ] Given the migration is applied, when the `plants` table is inspected, then the new ecological columns exist, are all nullable (or safely defaulted), and no existing row or PROJ-6 read is affected (additive, backward-compatible per the PROJ-11 contract).
- [ ] Given the ecological band columns, when a value is written, then a DB check constraint restricts it to the allowed vocabulary (none/low/medium/high), and bloom months to 1–12.
- [ ] Given a plant that has genuinely no wildlife value (e.g. wind-pollinated grass), when it is stored, then "none" is representable and distinct from null (not assessed).

### AI inference & confidence
- [ ] Given a species is run through the extended generate step, when inference completes, then each ecological trait is returned with its own high/medium/low confidence rating.
- [ ] Given an inferred row with any ecological trait at low confidence, when the row is staged, then it is flagged for mandatory curator review and cannot be committed until reviewed.
- [ ] Given the AI refuses or returns an out-of-vocabulary value, when the row is validated, then it fails validation loudly (no silent default), consistent with the existing pipeline.

### Verification & provenance
- [ ] Given a staged row, when the curator verifies an ecological trait against naturadb.de, then that trait is no longer marked AI-inferred in the row's provenance.
- [ ] Given a committed live row, when its ecological provenance is inspected, then it truthfully shows which ecological traits are still AI-inferred vs. human-verified.

### Backfill via sync
- [ ] Given the ~160 existing `open_data_etl` rows, when verified ecological traits are synced, then those rows receive the traits (sync only touches `open_data_etl`-owned rows).
- [ ] Given a hand-seeded row (`source = 'seed'`), when the sync runs, then its ecological traits are NOT changed by the pipeline (only manual admin edit can set them).
- [ ] Given the full pipeline is run live, when it completes, then the catalogue's ecological-trait coverage is reported (how many rows now have verified traits, how many remain null) — no silent partial coverage.

### Regression
- [ ] Given the extended pipeline, when the existing PROJ-11 ETL test suite runs, then it passes, plus new co-located tests covering the ecological trait schema, confidence gating, provenance marking, and sync field additions.
- [ ] Given a plan is generated after this feature ships, when the engine runs, then plans are identical to before (these traits do not affect selection).

## Edge Cases
- **Bloom period wrapping the year** (e.g. Nov→Feb for a winter bloomer): the schema must represent start > end as a valid wrap, and PROJ-15's coverage maths must be told to expect it. Documented here so PROJ-15 doesn't mis-handle it.
- **Plant assessed as "none" wildlife value:** a legitimate result, not a data gap — must not be treated as missing by PROJ-15.
- **naturadb.de has no entry for a species:** curator marks the trait unverifiable; it stays null (not guessed), and PROJ-15 treats null as "not assessed", not as "none".
- **AI high-confidence but actually wrong** (the native-flag failure mode): mandatory review covers low-confidence only, so the curator spot-check practice from PROJ-11 must extend to a sample of high-confidence ecological traits — noted as a curator-process requirement, not just a code gate.
- **Partial backfill** (some rows verified, some still null when PROJ-15 ships): expected; PROJ-15 must degrade gracefully (its own AC), and this feature must report coverage so the launch decision is informed.
- **A trait's confidence differs across the survival vs. ecological sets:** confidence is per-field; a row can be survival-verified but ecologically unverified, and vice versa. Provenance must track them independently.

## Technical Requirements (boundaries only — design is /architecture's)
- Additive, nullable, backward-compatible schema — no backfill baked into the migration, no PROJ-6 impact (the PROJ-11 additive contract).
- Reuse the existing `generate → commit → sync` pipeline and the confidence/provenance/mandatory-review machinery rather than a parallel pipeline.
- Extend `SYNCABLE_FIELDS` so verified ecological traits can reach live `open_data_etl` rows; the sync guard (never touch non-ETL rows) is unchanged.
- No user-facing runtime surface, no new env vars beyond the existing n8n/Anthropic ETL config.
- Coverage reporting on every live pipeline run.

## Open Questions
- [ ] Exact naturadb.de field → app-band mapping for insect/bird value (their scale vs. our none/low/medium/high) — resolve during the first curator session, document the mapping like PROJ-11's.
- [ ] Should bloom months be stored as two smallints or a single structured value? Design decision at /architecture.
- [ ] Whether PROJ-15 should down-weight AI-inferred-but-unverified ecological traits or exclude them entirely — flagged for PROJ-15's interview; this feature just makes the provenance available.
- [ ] Target coverage threshold before PROJ-15 is allowed to ship (e.g. ">80% of catalogue has verified wildlife value") — decide jointly when PROJ-15 is specced.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Split ecological-trait ETL (PROJ-14) from the indicator display (PROJ-15) | Different users (curator vs. end user), surfaces (pipeline vs. plan view), and test strategies; the data must ship and be verified before any user-facing claim. Mirrors PROJ-11 being its own feature. | 2026-07-10 |
| Trait set: insect value, bird value, bloom start/end, pollinator-friendly | The set naturadb.de actually publishes, so it's verifiable against the existing curation source; enough for a richness + wildlife + bloom-coverage indicator without over-modelling. | 2026-07-10 |
| Ordinal bands (none/low/medium/high), not raw counts | Matches the app's banded-honesty convention (PROJ-13); avoids implying precision naturadb.de doesn't provide. "none" distinct from null. | 2026-07-10 |
| AI infers a draft, human verifies before live; low-confidence = mandatory review | The native-flag ~40% error rate (seen twice) proves AI ecological output can't be trusted unverified, and these traits feed a persuasion metric. Same reasoning that added PROJ-11's sync/verify step. | 2026-07-10 |
| Backfill the existing ~160 rows via the existing sync step | Sync already safely touches only `open_data_etl` rows; backfilling means PROJ-15 covers most plans at launch instead of showing "unavailable" everywhere. Hand-seeded rows stay manual-edit-only. | 2026-07-10 |
| High-confidence traits still need a curator spot-check (process, not just code) | The native-flag failure was high-confidence-but-wrong; a code gate on low-confidence alone wouldn't have caught it. | 2026-07-10 |

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
