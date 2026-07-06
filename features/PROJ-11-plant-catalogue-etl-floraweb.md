# PROJ-11: Expand Plant Catalogue via FloraWeb/BfN ETL with AI-Assisted Trait Mapping

## Status: Planned
**Created:** 2026-07-06
**Last Updated:** 2026-07-06

## Summary
A one-time (repeatable-by-hand) offline import pipeline that grows the plant catalogue
well beyond the ~40 hand-seeded rows. FloraWeb/BfN defines **which** species belong in
the German catalogue and their **native status** (authoritative). An AI step infers the
horticultural traits the sources don't reliably express (sun, soil, moisture, mature size,
maintenance, hardiness zone, care notes), tagged with a confidence signal. A curator
reviews a human-readable **staging file** — correcting and approving the survival-critical
fields — and a second command upserts only approved rows into `public.plants`, marked with
their provenance. The `plants` table remains the *verified* catalogue that PROJ-6 plans from;
the staging file is the uncapped backlog of not-yet-reviewed species.

This extends the existing `npm run seed:plants` model (server-side, service-role, idempotent
upsert on `latin_name`) rather than replacing it.

## Dependencies
- **Requires:** PROJ-5 (Plant Database & Admin Interface) — the `public.plants` table, its
  vocabulary contract (`src/lib/plants.ts`), and `/admin/plants` for post-import curation.
- **Requires:** PROJ-1 (Supabase Infrastructure) — the service-role key + server-side seed
  pattern this pipeline reuses (bypasses RLS; must never run in the browser).
- **Consumed by / relates to:** PROJ-6 (Rule-Based Plan Generation) — the enlarged catalogue
  is what the rule engine plans from. Two follow-on PROJ-6 enhancements are explicitly *out of
  scope* here (see Out of Scope): consuming the new `moisture` field in matching, and weighting
  `native` plants in selection.

## User Stories
- As a **curator/admin**, I want to run one command that pulls a filtered set of German
  garden-suitable species from FloraWeb/BfN and produces a reviewable staging file with
  AI-inferred traits and confidence, so that I can expand the catalogue without hand-typing
  every plant.
- As a **curator/admin**, I want the survival-critical traits (sun, soil, moisture, hardiness
  zone) clearly flagged as AI-inferred with a confidence signal, so that I know exactly what I
  must verify before it reaches end users.
- As a **curator/admin**, I want to edit/approve rows in the staging file and then run a second
  command that commits only approved rows, so that nothing unreviewed ever reaches PROJ-6 planning.
- As a **curator/admin**, I want the import to skip species already in the catalogue (and never
  overwrite my manual edits), so that re-running the pipeline is safe and idempotent.
- As **Maya / Thomas (end users)**, I want plans drawn from a larger, ecologically-grounded
  palette with natives surfaced first, so that my plan feels credible, varied, and locally right —
  without me ever seeing the import machinery.
- As a **curator/admin**, I want each committed plant to record where its data came from and which
  fields are still AI-origin, so that authoritative facts are distinguishable from AI guesses for
  future re-verification.

## Out of Scope
<!-- Everything discussed but consciously excluded. -->
- **Repeatable/automated/scheduled sync** — no cron, no change-detection reconciliation against a
  live source. This is a manually re-runnable pipeline, not a live sync (a PRD v1 non-goal).
- **Runtime AI plant search** — AI querying external sources live at plan/search time. That is a
  PROJ-6 planner enhancement, not catalogue expansion.
- **PROJ-6 consuming the new `moisture` field in matching** — this feature *adds and populates*
  `moisture`; wiring it into the rule engine's survival filter is a follow-on PROJ-6 enhancement.
- **PROJ-6 weighting `native` in plant selection** — "natives first" here means import/listing
  ordering and honest surfacing of the `native` flag; changing the engine's selection weighting
  is a separate PROJ-6 enhancement.
- **Max/upper hardiness zone** — deferred (low value for Germany's narrow zone range ~5–8).
- **NaturaDB bulk redistribution** — not the trait source; the licensing question is avoided by
  having the AI infer traits. NaturaDB stays a manual per-species cross-reference only.
- **In-DB unverified queue** — unreviewed species live in the staging file, not as hidden rows in
  `public.plants`; the table stays the verified catalogue so PROJ-6 needs no verified-filter change.
- **Admin UI for the import** — review happens in the staging file; no new screens (uses existing
  `/admin/plants` for later corrections).
- **Bulk image hosting/CDN** — images remain external URLs (as today); this feature only adds
  attribution/license metadata alongside them.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Import (fetch + AI-map → staging)
- [ ] Given a curator runs the import command server-side with valid credentials, when it completes,
      then a human-readable staging file is produced with one entry per candidate species, each
      carrying its FloraWeb-sourced fields (species identity, `native` status), AI-inferred
      horticultural traits, a per-row/per-field confidence signal, and a `source` provenance marker.
- [ ] Given the FloraWeb selection filter, when species are pulled, then aquatics, pasture grasses,
      agricultural weeds, protected species, and non-orderable species are excluded, and both natives
      and curated non-invasive ornamentals are included.
- [ ] Given the staging file is generated, when it lists species, then **natives are ordered/surfaced
      first** ahead of non-natives.
- [ ] Given the AI infers a trait, when it writes the staging file, then every trait value validates
      against the app vocabulary (`plantSchema`: sun ∈ full/partial/shade, soil buckets, moisture
      buckets, `plant_type`, maintenance, whole-number zone, size in cm) — values outside the
      vocabulary are rejected/flagged, never silently written.
- [ ] Given a survival-critical field (sun, soil, moisture, hardiness zone) has low AI confidence,
      when the staging file is written, then that row is flagged as requiring mandatory review and
      cannot be committed while unresolved.
- [ ] Given a candidate species already exists in `public.plants` (by `latin_name`), when the staging
      file is generated, then the row is marked as an existing/conflict entry and is not set to
      silently overwrite the current (possibly admin-edited) row.

### Review + commit
- [ ] Given a curator has edited/approved rows in the staging file, when they run the commit command,
      then only rows explicitly marked approved are upserted into `public.plants`.
- [ ] Given the commit runs, when it upserts a row, then every field is re-validated against
      `plantSchema` server-side and rows failing validation are skipped and reported (partial commit
      is safe and reported, not all-or-nothing silent failure).
- [ ] Given committed rows, when they land in `public.plants`, then each records its `source`
      provenance and a marker of which survival-critical traits remain AI-origin vs. human-corrected.
- [ ] Given the commit completes, when it finishes, then it prints a report: counts of inserted,
      skipped-as-existing, and rejected rows (with reasons).
- [ ] Given the pipeline is re-run end-to-end, when it commits, then it never creates duplicate
      `latin_name` rows and never overwrites a row an admin has since edited (idempotency preserved
      from the existing seed contract).

### First batch + end-user effect
- [ ] Given the first import run, when the curator finishes review, then ~50–80 rows are approved and
      committed (verified), meaningfully growing the live catalogue beyond the ~40 seeded rows.
- [ ] Given the enlarged catalogue, when PROJ-6 generates a plan, then it draws only from committed
      (verified) rows and the resulting plans show greater variety across the four layers.
- [ ] Given a committed plant carries an image, when it is displayed, then its attribution/license
      metadata is stored alongside the image URL (so attribution can be surfaced where images render).

### Schema additions
- [ ] Given the catalogue schema, when this feature ships, then `public.plants` gains: a `moisture`/
      water-needs field (populated by the import), image attribution + license fields, and per-row
      provenance/AI-origin tracking — additive and backward-compatible with existing rows.

## Edge Cases
- **FloraWeb source unreachable or format changed** — the import fails loudly with a clear error and
  writes no partial/corrupt staging file.
- **AI returns an out-of-vocabulary or nonsensical trait** — rejected at staging validation; the row
  is flagged, never written with an invalid value.
- **AI low/zero confidence on a survival-critical field** — row flagged mandatory-review; blocked from
  commit until a human sets the value.
- **Species with no usable/licensed image** — committed with a null image and no fabricated
  attribution (UI placeholder, as today).
- **Curator hand-edits the staging file to an invalid value** — commit re-validates against
  `plantSchema` and rejects that row with a reported reason.
- **Partial commit failure (some rows upsert, some fail)** — successful rows persist; failures are
  reported per-row; no rollback of good rows.
- **Duplicate `latin_name` already in catalogue** — skipped (ON CONFLICT DO NOTHING semantics),
  flagged in the report; admin edits are never clobbered.
- **A previously committed species is later corrected in `/admin/plants`, then the pipeline re-runs** —
  the re-run must not overwrite the admin's correction.
- **Non-invasive judgment is wrong** (an included ornamental turns out weedy) — curator can exclude/
  correct via the staging file or later via `/admin/plants`; `native` stays an honest flag.

## Technical Requirements (optional)
- **Server-side only** — runs with the service-role key (bypasses RLS); must never execute in the
  browser (same constraint as `seed:plants`).
- **Idempotent** — upsert on `latin_name`, ON CONFLICT DO NOTHING; safe to re-run.
- **Two-step, human-in-the-loop** — fetch/AI-map/stage is separate from commit; approval is explicit.
- **Vocabulary-locked** — all trait values validate against `src/lib/plants.ts` / `plantSchema`
  before staging and again before commit.
- **Additive migration** — new columns (`moisture`, image attribution/license, provenance/AI-origin)
  must be backward-compatible with the existing ~40 rows and existing PROJ-5/6 reads.
- **Security** — no secrets committed; source-data licensing respected (see Open Questions); image
  attribution stored for compliance.

## Open Questions
<!-- Unresolved; close in /refine or /architecture when answered. -->
- [ ] **FloraWeb/BfN access + license (gating):** exact access method (documented API vs. bulk
      download vs. structured pages) and the license terms for redistributing *derived* data
      (species list + native status) in a commercial product. Needs verification before build.
- [ ] Does FloraWeb expose a clean filter for "orderable / ornamental / garden-suitable," or must the
      selection filter be AI-assisted / manually curated from the raw flora list?
- [ ] Provenance granularity: row-level `source` only, or per-field AI-origin flags? (Architecture.)
- [ ] Which Claude model + prompt strategy for trait inference, and how confidence is derived/
      thresholded. (Architecture.)
- [ ] `moisture` vocabulary — the exact bucket set (e.g. dry / moist / wet) and how it aligns with the
      existing soil buckets. (Architecture, with PROJ-6 in mind.)
- [ ] Where image attribution surfaces in the UI (plant card, plan view) — likely a small PROJ-6/
      PROJ-7 follow-on.
- [ ] Confirm invasive/neophyte exclusion list source (e.g. BfN Neophyten / Unionsliste) for the
      "non-invasive ornamentals" filter.

## Decision Log

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| One-time curated import, not an automated sync | Matches PRD "seeded once, curated via /admin" model; automated live sync is a v1 non-goal; lowest risk | 2026-07-06 |
| FloraWeb = species + native authority; AI infers horticultural traits | FloraWeb is authoritative on ecology/native status but thin on horticultural traits; having AI infer them avoids the NaturaDB redistribution-licensing block entirely | 2026-07-06 |
| Curator reviews a staging file; commit upserts only approved rows | Survival-critical AI traits decide whether a recommended plant lives; explicit human gate protects the survival-guarantee promise; fully offline, no new UI | 2026-07-06 |
| No cap on stored species; verification is the throttle | A bigger catalogue is strictly better for plan variety + the local-ecology promise; the real constraint is human review capacity, not storage. Staging file = uncapped backlog; `plants` table = verified catalogue | 2026-07-06 |
| Unreviewed species stay in the staging file, not an in-DB unverified queue | Keeps `public.plants` the verified catalogue so PROJ-6 needs no verified-filter rework | 2026-07-06 |
| Include natives + curated non-invasive ornamentals; surface natives first | Maya/Thomas value "won't take over my life" over botanical purity; proven staples (lavender, catmint) aren't native; `native` stays honest and is surfaced/ordered first | 2026-07-06 |
| Target ~50–80 verified rows in the first run | Roughly doubles the live catalogue and proves the fetch→AI→stage→review→commit loop without a punishing review session | 2026-07-06 |
| Schema additions in scope: `moisture`, image attribution/license, provenance/AI-origin | A bulk AI-assisted import stresses trade-offs a hand-curated 40 never did: can't tell AI guesses from facts (provenance), CC images legally need attribution, and dry-vs-wet shade is a real survival distinction | 2026-07-06 |
| Max/upper hardiness zone deferred | Low value for Germany's narrow zone range (~5–8); avoid scope creep | 2026-07-06 |
| PROJ-6 consuming `moisture` and weighting `native` are out of scope | Keeps this a data/pipeline feature (single responsibility); engine changes are separate PROJ-6 enhancements | 2026-07-06 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| _To be added by /architecture_ | | |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
