# PROJ-14: Ecological Trait Enrichment (ETL extension)

## Status: Approved
**Created:** 2026-07-10
**Last Updated:** 2026-07-10 (QA passed — /qa)

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
- [x] Should bloom months be stored as two smallints or a single structured value? **Resolved (/architecture, 2026-07-10): two nullable smallint columns** (`bloom_start_month`, `bloom_end_month`), each check-constrained 1–12; year-wrap is `start > end`.
- [ ] Whether PROJ-15 should down-weight AI-inferred-but-unverified ecological traits or exclude them entirely — flagged for PROJ-15's interview; this feature just makes the provenance available (via the separate `eco_ai_origin_fields` list).
- [ ] Target coverage threshold before PROJ-15 is allowed to ship (e.g. ">80% of catalogue has verified wildlife value") — decide jointly when PROJ-15 is specced. First backfill prioritises wildlife values (decision, 2026-07-10), so that band is the first to reach a decidable threshold.

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
| Decision | Rationale | Date |
|----------|-----------|------|
| Bloom period = two nullable smallint columns (`bloom_start_month`, `bloom_end_month`), each check-constrained 1–12 | Simplest stable shape; the year-wrap case (Nov→Feb) is just `start > end`, which needs no special storage — only PROJ-15's coverage maths must expect it (already noted in this spec's Edge Cases). A single structured/JSON value would add parsing with no benefit. | 2026-07-10 |
| Wildlife values = ordinal text columns (`insect_value`, `bird_value`) with a DB check for `none/low/medium/high`; both nullable | Matches PROJ-11's pattern of a check-constrained text column (like `moisture`) and the app's banded-honesty convention (PROJ-13). `null` = not assessed, `'none'` = genuinely no value — two distinct states PROJ-15 must not conflate. | 2026-07-10 |
| `pollinator_friendly` = nullable boolean | A flag, not a band; `null` distinguishes "not assessed" from `false` ("assessed, not pollinator-friendly"). | 2026-07-10 |
| Ecological provenance stored in a **separate** `eco_ai_origin_fields` array, not by widening `ai_origin_fields` | Keeps the survival and ecological trust sets independent (a spec edge case: a row can be survival-verified but ecologically unverified). Critically, it lets the sync/backfill step push ecological provenance to a live row **without clobbering** any survival-trait verification a curator did earlier. Widening the single existing array would force merge logic during sync or silently reset survival provenance. | 2026-07-10 |
| Confidence is per ecological trait (`insect_value`, `bird_value`, `bloom_period`, `pollinator_friendly`), extending the existing `confidence` block | Reuses PROJ-11's per-field confidence machinery; one confidence for the bloom pair (they're inferred together). Any ecological trait at low confidence sets the row's existing `review_required` gate — one gate, now fed by both trait sets. | 2026-07-10 |
| Commit allows high-confidence AI-inferred ecological traits to go live (marked in `eco_ai_origin_fields`); only low-confidence blocks commit | Exactly PROJ-11's contract. The provenance column is what lets PROJ-15 later choose to down-weight/caveat AI-inferred data; the "high-confidence but wrong" failure mode is handled by the curator spot-check *process*, not a hard gate that would block the whole backfill. | 2026-07-10 |
| Backfill via extended `SYNCABLE_FIELDS` (the 5 trait columns + `eco_ai_origin_fields`); sync guard unchanged | The `source = 'open_data_etl'`-only guard already protects hand-seeded/admin rows. Adding the ecological columns to the syncable set is the whole backfill mechanism — no new script. | 2026-07-10 |
| Hand-seeded rows get ecological traits via an extended **admin plant-form** (user decision, 2026-07-10) | The pipeline deliberately won't touch non-ETL rows, so the 2 hand-seeded plants need a manual path; the admin edit form is the honest place for it, and PROJ-15 needs the same form fields regardless. | 2026-07-10 |
| First backfill prioritises **wildlife values** (insect/bird + pollinator flag), bloom months follow (user decision, 2026-07-10) | Those three are PROJ-15's headline-claim inputs; verifying them first maximises useful coverage per curator hour. Bloom-season coverage is secondary and can trail. | 2026-07-10 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

> **Audience note:** this is a data-pipeline / curator feature with no end-user runtime surface (that's PROJ-15). It extends the existing PROJ-11 import pipeline rather than adding a parallel one, so the design below is mostly "which existing part gets a bit more, and why" — deliberately small and additive.

### A) Where the work lands (module / data-flow map)

The PROJ-11 pipeline has three stages the curator already runs. PROJ-14 threads five new ecological traits through the same three stages plus one manual side-door for the hand-seeded rows:

```
STEP 1  Generate & stage   (npm run import:plants)
  Open-data identity  ─┐
  AI trait inference  ─┼─► now ALSO drafts the 5 ecological traits
                       │    + a confidence rating for each
                       └─► writes them into the YAML staging file,
                            low-confidence rows flagged REVIEW REQUIRED

STEP 2  Curator review      (edit the YAML by hand)
  Check each ecological trait against naturadb.de
  Correct any value; remove verified traits from the row's
  ecological-provenance list; set approved: true

STEP 3a Commit new rows     (npm run import:plants:commit)
  Approved, review-cleared rows written to public.plants
  (unchanged gate: low-confidence still can't commit)

STEP 3b Sync existing rows  (npm run import:plants:sync)   ◄── the backfill
  Pushes verified ecological traits onto the ~160 live
  open_data_etl rows (never touches seed/admin rows)
  + reports ecological-trait coverage

SIDE DOOR  Admin plant-form  (/admin/plants → edit)
  New "Ecological traits" section so an admin can set the 5
  fields on the 2 hand-seeded rows the pipeline won't touch
```

Files that grow (no new pipeline modules):
- `scripts/lib/catalogue.mjs` — the shared vocabulary/validation: new ecological enums, extend the row schema, the confidence schema, the review gate, `SYNCABLE_FIELDS`, and the new coverage report helper.
- `scripts/lib/ai-traits.mjs` — the AI now returns the 5 ecological traits + their confidence (structured-output schema + prompt).
- `scripts/import-plants-sync.mjs` — print the coverage report at the end of a run.
- `supabase/migrations/…proj14_plants_ecological_traits.sql` — the additive columns.
- `src/lib/plants.ts` + `src/components/admin/plant-form.tsx` — the admin-form side door.

### B) Data model (plain language)

Five new pieces of information per plant, all **nullable** (nothing is backfilled by the migration; existing rows and every PROJ-6 read keep working):

```
Each plant additionally has:
- Insect / pollinator value   one of: none · low · medium · high   (null = not assessed)
- Bird / wildlife value       one of: none · low · medium · high   (null = not assessed)
- Bloom start month           1–12   (null = not assessed / non-flowering)
- Bloom end month             1–12   (null; may be < start for a winter bloomer that wraps the year)
- Pollinator-friendly         yes / no   (null = not assessed)

Provenance (which of the above are still an AI guess vs. human-verified):
- Ecological-origin list      kept SEPARATE from the existing survival-origin list,
                              so verifying a wildlife value never disturbs an earlier
                              survival-trait verification.
```

Two states that must stay distinct downstream: **null** ("we haven't assessed this") and **none/false** ("we assessed it — the answer is genuinely nothing"). The database check constraints allow `none` as a real value; the columns stay nullable so "not assessed" remains representable.

Stored in: the existing `public.plants` table (Supabase Postgres). No new table, no RLS change — the PROJ-5 policies (all authenticated read, admins write) already cover new columns.

### C) Tech decisions justified (for a PM)

- **Extend the pipeline, don't fork it.** Every ecological trait rides the exact `generate → review → commit → sync` path the catalogue already trusts. Less to build, and the hard-won review discipline (nothing AI-inferred goes live unverified-and-unmarked) is inherited for free rather than re-implemented.
- **AI drafts, a human signs off — same rule as the native flag.** The GBIF native flag was wrong ~40% of the time, twice. These traits feed a *persuasion* metric (PROJ-15's biodiversity claim), so the bar is the same: the AI produces a confident draft, low-confidence forces mandatory review, and everything AI-inferred is marked so it can be re-checked or down-weighted later. High-confidence-but-wrong is caught by a curator spot-check habit, not pretended away.
- **A separate provenance list for ecological traits.** The single most important structural choice: it means the backfill can push wildlife values onto a live plant without accidentally un-verifying a survival trait a curator fixed months earlier. Independent trust sets, independent tracking.
- **Bands, not numbers.** Wildlife value is none/low/medium/high, never a count — matching the app's honesty convention and what naturadb.de can actually support.
- **The migration changes nothing that already works.** All columns nullable, no backfill in the migration, the plan engine (PROJ-6) never reads them — so plans generated after this ships are byte-identical to before.
- **Coverage is reported, never assumed.** Every live sync run prints how many rows now have verified wildlife values and how many are still null, so the PROJ-15 ship decision is made on real numbers, not a hope that "most" plants are covered.

### D) Dependencies (packages)

None new. Reuses the existing stack: `@anthropic-ai/sdk` (trait inference), `@supabase/supabase-js` (service-role reads/writes), `zod` (validation), `yaml` (staging file). No new env vars beyond the existing n8n/Anthropic ETL config.

## Implementation Notes — Frontend (2026-07-10, /frontend)

This feature's only UI surface is the tech design's **side door**: the admin plant-form
"Ecological traits" section, so hand-seeded rows (and any admin correction) have a manual
path for the five traits the pipeline deliberately won't touch. Everything else in PROJ-14
(migration, ETL inference, review gate, sync backfill, coverage report) is `/backend`.

**`src/lib/plants.ts` — the shared contract, extended:**
- `WILDLIFE_VALUE_OPTIONS` (`none/low/medium/high` + labels), `MONTH_OPTIONS` (1–12 + names),
  `ECOLOGICAL_TRAIT_FIELDS` (`insect_value`, `bird_value`, `bloom_period`, `pollinator_friendly`)
  — the allowed contents of the **separate** `eco_ai_origin_fields` provenance array, with the
  bloom pair tracked as one entry (`bloom_period`) since the months are inferred together.
- `Plant` type + `plantSchema` gain the 5 columns + `eco_ai_origin_fields`, all
  **nullable + optional** (every existing row and caller keeps validating — the additive
  contract). Vocabulary enums derive from the option arrays via `optionValues()` per the
  one-soil-vocabulary convention.
- Cross-field rule (`superRefine`): the bloom pair is **both-or-neither** — a half-set pair
  fails with a field-level error. `end < start` is deliberately VALID (year-wrap, Nov→Feb).
- Helpers: `wildlifeValueLabel`, `monthLabel`, `bloomPeriodSummary` ("November – February
  (over winter)") — ready for PROJ-15's display layer.

**`src/components/admin/plant-form.tsx` — the "Ecological traits" fieldset** (after the
native switch): insect + bird value selects, pollinator-friendly select, bloom first/last
month selects. Design decisions:
- Every select includes an explicit **"Not assessed"** item (sentinel `not_assessed` ⟷ NULL;
  Radix Select can't carry an empty value) and defaults to it — the honest default is a NULL,
  never a guessed value. Pollinator-friendly is a tri-state select (Not assessed / Yes / No),
  not a Switch, because `null` ≠ `false` here.
- Traits listed in the row's `eco_ai_origin_fields` show an **"AI-inferred — not yet
  verified"** chip next to their label, so an admin editing an ETL row sees which values are
  still unverified drafts. The form does not auto-mutate provenance (matching the existing
  form's treatment of `ai_origin_fields`); clearing provenance stays a pipeline/curator step.
- Section copy states the trust rule: verify against naturadb.de, leave "Not assessed" rather
  than guess, "None" = checked and genuinely no value. A hint under the bloom pair explains
  that last-before-first means a year-wrapping bloom.

**Tests:** `plants.test.ts` +11 (vocabulary accept/reject, null vs `none`/`false` distinct,
month bounds, wrap valid, half-pair rejected with the right field error, provenance
vocabulary, label/summary helpers) and new co-located `plant-form.test.tsx` +5 (not-assessed
defaults, untouched traits persist as NULL, assessed values incl. wrap round-trip, provenance
chips only on listed traits, half-set bloom pair blocks save). Suite 401 → 417 green; lint +
production build clean.

**⚠️ Staged-flow caveat (same as PROJ-5's):** `savePlant` spreads the validated values, so
the admin form now includes the five ecological columns in every insert/update. **Any plant
save via the admin form will error against the live DB until the PROJ-14 migration is
applied** — `/backend` (migration + pipeline) is the immediate next step and must land before
this reaches production.

## Implementation Notes — Backend (2026-07-10, /backend)

The pipeline half of the feature — everything except the admin-form side door (built at
`/frontend`). No API route: PROJ-14 has no runtime surface (that's PROJ-15); it extends the
offline `generate → commit → sync` scripts and their pure, unit-tested contract in
`scripts/lib/`. All additive, backward-compatible — the plan engine (PROJ-6) never reads the
new columns, so plans generated after this ships are byte-identical to before.

**Migration `20260710110000_proj14_plants_ecological_traits.sql`** — six additive, nullable
columns on `public.plants`: `insect_value` / `bird_value` (text, `check none/low/medium/high`),
`bloom_start_month` / `bloom_end_month` (smallint, `check 1–12`), `pollinator_friendly`
(boolean), and the **separate** `eco_ai_origin_fields` (text[], `check <@` the 4 ecological
field names). Plus a guarded (`do $$…`, idempotent) cross-column constraint
`plants_bloom_pair_both_or_neither` enforcing the both-or-neither bloom rule at the DB. Nothing
backfilled; no RLS change (PROJ-5 policies already cover new columns). `none`/`false` are real
assessed values, kept distinct from NULL ("not assessed") — the two states PROJ-15 must not
conflate.
**⚠️ Deploy gate — apply via the Supabase dashboard SQL Editor** (this project doesn't use CLI
migration history). Until it lands, admin plant saves error against live (the frontend now sends
these columns on every save). No env vars, no n8n change.

**`scripts/lib/catalogue.mjs`** — the shared contract, extended and kept locked to
`@/lib/plants` by `catalogue.test.ts`:
- New vocab: `WILDLIFE_VALUE_VALUES`, `BLOOM_MONTH_MIN/MAX`, `ECOLOGICAL_TRAIT_FIELDS`
  (mirrors the app; bloom pair = one `bloom_period` entry), `CONFIDENCE_FIELDS` (survival + eco).
- `importPlantSchema` gains the 5 columns + `eco_ai_origin_fields`. insect/bird/pollinator are
  **required** (the AI always assesses them — a missing/out-of-vocab value fails loudly, no
  silent default); the bloom pair is nullable + both-or-neither (`end < start` = valid wrap).
- `confidenceSchema` gains 4 eco keys (`insect_value`, `bird_value`, `bloom_period`,
  `pollinator_friendly`). `lowConfidenceFields`/`needsMandatoryReview` now scan **both** trait
  sets → **one** `review_required` gate fed by survival AND ecological low-confidence.
- `buildStagedRow` copies the eco values through and seeds `eco_ai_origin_fields` with all four
  (every trait starts an AI draft), kept independent of `ai_origin_fields`.
- **`SYNCABLE_FIELDS`** extended with the 5 eco columns + `eco_ai_origin_fields` — this is the
  whole backfill mechanism. `ai_origin_fields` is deliberately NOT syncable, so pushing eco
  provenance never disturbs a survival verification. New order-insensitive array comparison
  (`syncFieldEqual`) so `eco_ai_origin_fields` in a different order isn't seen as a change.
- `planSync` now also skips `review_required` rows (an unverified low-confidence trait must
  never reach a live row — same gate as commit) → new `skippedReview` bucket.
- New `ecologicalCoverageReport(rows)` — per-trait verified / AI-inferred / not-assessed counts
  (a trait is *verified* only when set AND absent from `eco_ai_origin_fields`; bloom counts as
  assessed only when both months set).

**`scripts/lib/ai-traits.mjs`** — `aiTraitsSchema` + `traitsJsonSchema` return the 5 eco traits
(bands enum-locked, bloom months `['integer','null']`, both-or-neither via superRefine) and the
4 eco confidence ratings; system prompt gained an "Ecological traits" block (bands, the year-wrap
rule, null-both for non-flowering, honest confidence).

**`scripts/import-plants-sync.mjs`** — prints the ecological-coverage report over a fresh read of
the live catalogue **after** the updates apply (spec: no silent partial coverage), plus the new
`skippedReview` line. **`scripts/lib/staging.mjs`** — curator HOW-TO-REVIEW header now covers the
eco fields, naturadb.de verification, the high-confidence spot-check habit, and clearing
`eco_ai_origin_fields`. `import-plants.mjs` needed no change (traits flow through `buildStagedRow`).

**Tests:** `catalogue.test.ts` +18 (vocab/field-list parity, eco schema accept/reject, `none`≠null,
bloom bounds + wrap + half-pair, provenance vocabulary, one-gate review from either set, separate
eco provenance array, sync eco-backfill + order-insensitive idempotency + review-gate skip +
`ai_origin_fields`-never-synced, coverage report) and `ai-traits.test.ts` +5 (eco traits returned,
`none`/null-bloom accepted, out-of-vocab band + half-pair rejected, json_schema eco enums). Full
suite **417 → 440 green**, lint + production build clean.

**Remaining (curator + deploy, out of code scope):** apply the migration (dashboard SQL Editor);
run the live pipeline (`import:plants` → curator review against naturadb.de, wildlife values first
per the decision log → `import:plants:commit` → `import:plants:sync` backfill) and record the
first naturadb.de field → band mapping (Open Question) + the reported coverage. `/qa` next.

## QA Test Results

**QA date:** 2026-07-10 · **Tester:** /qa · **Verdict: APPROVED** (no Critical/High bugs)

### Scope note
PROJ-14 is a data-pipeline / curator feature with **no end-user runtime surface** (that's
PROJ-15). Its logic lives in pure, unit-testable modules (`scripts/lib/*.mjs`, `src/lib/plants.ts`)
plus one admin-form side-door. So QA is: exhaustive code review against every AC, the full
automated suite, a security/RLS audit, and a regression pass. Live-DB verification of the schema
and the live pipeline coverage numbers are **deploy/curator-gated** (the migration is deliberately
not yet applied) and are listed under "Deferred to deploy/curator" below — they are not bugs.

### Automated suites
| Suite | Result |
|-------|--------|
| Unit/integration (Vitest) | **440 / 440 pass** (417 → 440, +23 for PROJ-14) |
| E2E (Playwright) | **92 / 92 pass** — zero regressions |
| ESLint | clean |
| Production build | clean |

### Acceptance criteria
| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | New eco columns exist, all nullable, additive, no PROJ-6 read affected | ✅ PASS | Migration is all `add column if not exists`, nullable, no backfill; PROJ-6 engine never selects them; 252-site guardrail + full engine suite unchanged & green |
| 2 | DB check constrains vocabulary (none/low/medium/high) + bloom 1–12 | ✅ PASS | `check` clauses in `20260710110000_*.sql`; `eco_ai_origin_fields <@` subset check |
| 3 | `'none'` representable & distinct from NULL | ✅ PASS | CHECK allows `'none'`; column stays nullable; `catalogue.test.ts` "'none' ≠ null" |
| 4 | Each eco trait returned with its own confidence | ✅ PASS | `confidenceSchema` has 4 eco keys; `ai-traits.test.ts` "returns eco traits + confidence" |
| 5 | Any low-confidence eco trait → mandatory review, blocks commit | ✅ PASS | `needsMandatoryReview` scans both sets → one `review_required` gate; `planCommit`/`planSync` skip it; tested both ways |
| 6 | Out-of-vocab / refusal fails loudly, no silent default | ✅ PASS | json_schema enums + zod re-validation; tests reject out-of-vocab band, half-set bloom, refusal |
| 7 | Verified trait no longer marked AI-inferred | ✅ PASS | Curator removes field from `eco_ai_origin_fields`; coverage counts verified only when set AND absent from the array |
| 8 | Live-row provenance truthfully shows AI vs verified | ✅ PASS | Separate `eco_ai_origin_fields` column; independent of survival `ai_origin_fields` |
| 9 | ~160 ETL rows backfilled via sync | ✅ PASS | Eco columns + `eco_ai_origin_fields` added to `SYNCABLE_FIELDS`; `planSync` test backfills nulls → values |
| 10 | Hand-seeded (`source='seed'`) rows untouched by sync | ✅ PASS | `planSync` skips `source !== 'open_data_etl'`; dedicated test |
| 11 | Coverage reported on every live run (no silent partial) | ✅ PASS (code) | `ecologicalCoverageReport` + sync script prints per-trait verified/AI/not-assessed over a fresh post-update read. *Live numbers deploy-gated.* |
| 12 | PROJ-11 suite passes + new co-located tests | ✅ PASS | 440 green incl. +18 catalogue, +5 ai-traits, +11 plants, +5 plant-form |
| 13 | Plans identical after ship (engine unaffected) | ✅ PASS | PROJ-6 reads none of the new columns; engine + guardrail suites unchanged |

**13 / 13 acceptance criteria pass** (AC-11 live coverage numbers deferred to the curator run).

### Edge cases verified (in tests)
- Year-wrapping bloom (`end < start`, Nov→Feb) accepted as valid everywhere (schema, coverage, form summary "(over winter)"). ✅
- `'none'` wildlife value treated as assessed, never as a data gap. ✅
- Half-set bloom pair rejected with a field-level error (both-or-neither) at schema, AI-schema, and form layers. ✅
- Survival vs. ecological provenance tracked independently — a row can be survival-verified but ecologically unverified; sync never clobbers `ai_origin_fields`. ✅
- Coverage counts bloom as assessed only when BOTH months set. ✅

### Security audit (red-team) — clean
- **RLS:** No policy change (correct). The plants table's PROJ-5 policies are row-level, so they cover the new columns automatically. The PROJ-5 plants RLS E2E still passes — a regular authenticated user **cannot** insert/update/delete a plant, so cannot write eco traits. Admin-only write confirmed live.
- **Defense in depth:** DB check constraints reject out-of-vocabulary bands / out-of-range months even if app-layer validation were bypassed; `eco_ai_origin_fields <@ array[...]` blocks arbitrary strings in the provenance array.
- **Attack surface:** No new API route, no new env var, no new secret, no runtime input path. Reads use `select('*')` (safe before migration — they simply omit absent columns). Nothing to inject.

### Regression
- Full E2E (92) green across PROJ-3–8 RLS/flows; unit suite 440 green. The additive, engine-untouched design means plan generation is byte-identical to before.
- Production is **not** currently affected: the two PROJ-14 commits are local only (`HEAD` is 2 ahead of `origin/main`), so the eco-column-sending admin form is not yet live. Migration + push land together at `/deploy`.

### Bugs found
**None Critical / High / Medium.**

**Observation (Low / informational — no fix required):** Editing an *ETL-owned* row's eco value via the admin form does not clear that trait's stale `eco_ai_origin_fields` entry (`savePlant` deliberately doesn't send the provenance array), so the coverage report would still count it AI-inferred. This is the documented, intended design — ETL rows are corrected via the YAML → `import:plants:sync` pipeline; the admin form side-door exists for the 2 hand-seeded rows, which carry NULL provenance and so are counted as verified once set. Worth a line in the curator runbook.

### Deferred to deploy/curator (not bugs — gated on the migration + live pipeline)
1. Apply `20260710110000_proj14_plants_ecological_traits.sql` via the Supabase dashboard SQL Editor, then confirm columns/constraints live and an admin plant save round-trips.
2. Run the live pipeline (`import:plants` → naturadb.de curator review, wildlife values first → `import:plants:commit` → `import:plants:sync`) and record: the naturadb.de field → band mapping (Open Question) and the reported coverage numbers.
3. Spot-check a sample of **high-confidence** eco traits against naturadb.de (the "high-confidence-but-wrong" native-flag failure mode — a curator-process check, not a code gate).

### Test note
No new QA tests were added: the implementation shipped with comprehensive co-located coverage of
every AC's logic (`catalogue.test.ts`, `ai-traits.test.ts`, `plants.test.ts`, `plant-form.test.tsx`),
and the only surface not covered by them — an admin-form save round-trip against the live DB — is
deploy-gated (needs the migration applied) rather than genuinely untestable, so a live E2E for it
belongs after deploy.

## Deployment
_To be added by /deploy_

## Deployment
_To be added by /deploy_
