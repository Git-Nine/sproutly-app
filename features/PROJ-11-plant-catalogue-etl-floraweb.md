# PROJ-11: Expand Plant Catalogue via FloraWeb/BfN ETL with AI-Assisted Trait Mapping

## Status: In Review
**Created:** 2026-07-06
**Last Updated:** 2026-07-06 (QA complete — see QA Test Results)

## Summary
A one-time (repeatable-by-hand) offline import pipeline that grows the plant catalogue
well beyond the ~40 hand-seeded rows. An **open-data stack** (GBIF + POWO/WCVP + World
Flora Online + Wikidata — all commercially reusable) defines **which** species belong in
the German catalogue and their **native status**; FloraWeb/BfN, whose data is not openly
licensed, is demoted to an optional curator cross-reference only *(source strategy set in
/architecture, 2026-07-06 — see Tech Design)*. An AI step infers the
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
- [x] **Source + licensing — RESOLVED (FloraWeb licensing block removed):** the design now leads with
      an **open-data stack** — GBIF (CC0/CC-BY datasets) for the German species list + native status,
      POWO/WCVP (CC-BY) for native range, WFO (CC0) for names, Wikidata (CC0) for German common names.
      All permit commercial redistribution of derived data with attribution, so FloraWeb (non-open) is
      demoted to an optional curator cross-reference and is never shipped. See Technical Decisions.
- [ ] **Per-dataset licence check (small, mechanical — before commit):** GBIF/Catalogue of Life licences
      are set per dataset, not globally, and a German checklist mirrored there can be CC-BY-NC or trace
      back to a restricted source. The importer must filter to CC0/CC-BY and record each row's source
      dataset + licence. This replaces the former gating BfN-permission question.
- [x] **Garden-suitable filter — RESOLVED:** no source has a reliable "orderable/ornamental" flag, so
      selection is a **curated allowlist + rule-based exclusions** (native status, habitat, invasive
      lists), not a single-source query.
- [x] **Gardening traits are not in any open source — RESOLVED:** confirmed across GBIF, POWO, WFO,
      Wikidata, GermanSL, BiolFlor, TRY, LEDA, GIFT and USDA — none carry sun/garden-soil/moisture/
      mature-size/hardiness/care-notes. AI inference (or a commercial source like RHS) is the only
      path; the open stack supplies names + native status only.
- [x] **Provenance granularity — RESOLVED:** **per-field AI-origin flags** for the survival-critical
      traits, plus a row-level `source` marker.
- [x] **Model + prompt + confidence — RESOLVED:** `claude-opus-4-8` via the Anthropic SDK, structured
      outputs constrained to `plantSchema`, with a **per-field confidence** signal; low confidence on
      any survival-critical field → mandatory review, blocks commit until resolved.
- [x] **`moisture` vocabulary — RESOLVED:** `dry` / `moist` / `wet` (three buckets), a field of its
      own separate from soil; aligns with FloraWeb/BiolFlor Ellenberg moisture (F) values.
- [x] **Invasive-exclusion source — RESOLVED:** EU Unionsliste (Reg. 1143/2014, current via
      Implementing Reg. 2025/1422 — reusable as an EU official work) + BfN Neobiota national lists,
      cross-checked with FloraWeb floristic status (exclude non-`I`).
- [ ] Where image attribution surfaces in the UI (plant card, plan view) — a small PROJ-6/PROJ-7
      display-side follow-on, out of scope for this data/pipeline feature.

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
| Two offline Node scripts extending the `seed:plants` pattern (`import:plants` → stage, `import:plants:commit` → commit), not a new app surface | Reuses the proven server-side, service-role, idempotent-upsert model; no RLS/UI/route work; keeps the human review gate outside the app entirely | 2026-07-06 |
| **Primary source stack = openly-licensed data, NOT FloraWeb:** GBIF (filtered to CC0/CC-BY datasets) for the German species list + native/introduced status, cross-checked with POWO/WCVP (Kew, CC-BY) for native range, with World Flora Online (CC0) as the name/taxonomy backbone | These sources permit **commercial redistribution of derived data with attribution** — which FloraWeb does not. Leading with them turns the FloraWeb licensing block from a gating risk into a non-issue for the species list + native status. All three have real APIs / bulk downloads and are machine-readable | 2026-07-06 |
| Native status derived from POWO/WCVP native-vs-introduced range (Germany is a distribution unit) + GBIF `establishmentMeans`, normalized to the boolean `plants.native` | POWO gives authoritative native range at country resolution under a clean CC-BY licence; GBIF's per-record establishment flag corroborates it. Both are commercially reusable, unlike FloraWeb's `Floristischer Status` | 2026-07-06 |
| German common names enriched from Wikidata (CC0) | Wikidata is fully commercially reusable and carries German vernacular names (property P1843); it fills the common-name column without any licensing concern | 2026-07-06 |
| FloraWeb / GermanSL / BiolFlor kept only as an **optional, non-redistributed cross-reference** for a curator during review — never the shipped source | Their German coverage is excellent but their licences are restrictive/unverified (FloraWeb: consent required; GermanSL/BiolFlor: no clear commercial licence; BiolFlor also went offline ~Sept 2024). Consulting them to sanity-check a value is fine; redistributing their data is not | 2026-07-06 |
| **Per-dataset licence check is mandatory** on every GBIF/Catalogue of Life pull before commit | GBIF and CoL licences are per-dataset/per-sector, not global — a German checklist mirrored there may itself be CC-BY-NC or trace back to BfN. The importer must filter to CC0/CC-BY and record each row's source dataset + licence | 2026-07-06 |
| No open source carries gardening traits — confirmed across GBIF, POWO, WFO, Wikidata, GermanSL, BiolFlor, TRY, LEDA, GIFT, USDA | Validates the core design bet: sun/garden-soil/moisture/mature-size/hardiness/care-notes must be AI-inferred (or bought from a commercial horticultural source like RHS); the open stack supplies only names + native status | 2026-07-06 |
| Invasive-exclusion list: EU Unionsliste (Reg. 1143/2014, current via Implementing Reg. 2025/1422) is reusable as an EU official work; BfN Neobiota national lists supplement it | The EU list is legally binding and, as official EU legislation, is freely reusable — so it can be redistributed/embedded without a licensing concern; BfN's broader national lists catch invasives beyond the EU set | 2026-07-06 |
| Selection filter = rule-based exclusions (status + habitat) over a curated allowlist, not a native "garden-suitable" flag | FloraWeb has no "ornamental/orderable" attribute; garden-suitability must be curated. Excludes aquatics, grasses, weeds, protected and invasive species; includes natives + curated non-invasive ornamentals | 2026-07-06 |
| Invasive exclusion sourced from the EU Unionsliste (Reg. 1143/2014) + BfN neophyte/management lists, cross-checked with FloraWeb's own native-status field | These are the authoritative German/EU invasive-species references; combining them with FloraWeb's `Status` (indigen/Archäophyt/Neophyt) gives a defensible non-invasive filter | 2026-07-06 |
| AI trait inference = one Claude call per species via the Anthropic SDK, using **structured outputs** constrained to a schema mirroring `plantSchema` | Forcing the model to emit only vocabulary-valid values (sun/soil/moisture buckets, whole-number zone, sizes in cm, maintenance, plant_type) means out-of-vocabulary traits are rejected at the source, not silently written | 2026-07-06 |
| Model: `claude-opus-4-8`; the model returns a per-field confidence signal for the survival-critical traits | Careful, vocabulary-locked inference over survival-critical fields warrants the most capable default model; per-field confidence (not one row-level score) is what drives the mandatory-review gate | 2026-07-06 |
| FloraWeb/BiolFlor Ellenberg indicator values (light L, moisture F) fed to the AI as grounding for sun and moisture | These ecological values are authoritative and directly relevant to two survival-critical traits, raising inference confidence and giving a cross-check against the AI's guess | 2026-07-06 |
| Provenance granularity: **per-field AI-origin flags** for the survival-critical traits, plus a row-level `source` marker | Resolves the open question — knowing exactly which of sun/soil/moisture/zone is still an AI guess vs. human-corrected is what enables targeted future re-verification; a row-level flag alone loses that | 2026-07-06 |
| `moisture` vocabulary = `dry` / `moist` / `wet` (three buckets), stored as its own field separate from soil | Dry-vs-wet shade is a real survival distinction the soil buckets don't capture; three buckets align cleanly with Ellenberg F and keep the field simple for the later PROJ-6 wiring | 2026-07-06 |
| Staging file = a single human-readable YAML file (identity, native, AI traits, per-field confidence, review flags, `approved` flag, source) | YAML lets a curator read inline confidence/flags, edit values, add comments, and flip `approved: true` per row in one file — more ergonomic for survival-critical review than CSV/JSON; adds one small parser dependency | 2026-07-06 |
| Commit is idempotent: upsert on `latin_name`, ON CONFLICT DO NOTHING; only `approved: true` rows; re-validate every field server-side; partial commit is safe and reported | Inherits the existing seed idempotency contract so re-runs never duplicate or clobber admin edits; per-row validation + reporting means one bad hand-edit skips its row, not the whole batch | 2026-07-06 |
| New schema columns are additive and nullable/defaulted (`moisture`, `image_attribution`, `image_license`, `source`, `ai_origin_fields`) | The existing ~40 rows and all PROJ-5/PROJ-6 reads keep working unchanged; the migration backfills nothing and breaks nothing | 2026-07-06 |
| New dependency `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` env var; runs server-side only | The AI step needs the SDK and a key; the key is a build-time/curator-machine secret, never shipped to the browser, same trust boundary as `SUPABASE_SERVICE_ROLE_KEY` | 2026-07-06 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### In one sentence
Two offline command-line steps — **stage** and **commit** — grow the plant catalogue: the first pulls
a filtered set of German species from FloraWeb, has AI fill in the gardening traits FloraWeb doesn't
carry, and writes a reviewable file; a curator checks and approves rows in that file; the second commits
only approved rows into the live catalogue. There is **no new screen and no new page** — the whole
feature is machinery a curator runs, plus a few new columns on the existing plants table.

### Why there's no UI
The spec deliberately keeps unreviewed species out of the live catalogue and off any screen. The review
happens in a plain file on the curator's machine, and corrections after commit use the **existing**
`/admin/plants` interface. So this feature adds no components, no API routes, and no RLS policies — it
extends the same offline `npm run seed:plants` pattern the catalogue was first built with.

### The pipeline (what runs, in order)

```
STEP 1 — Import & stage        (curator runs:  npm run import:plants)
  1. Pull candidate species from the open-data stack
     - GBIF (CC0/CC-BY datasets) → German species list + native status
     - POWO/WCVP (CC-BY)          → confirm native-vs-introduced range
     - World Flora Online (CC0)   → normalize names / taxonomy
     - Wikidata (CC0)             → German common names
     (all commercially reusable; FloraWeb is only a curator cross-reference)
  2. Apply the selection filter
     - EXCLUDE: aquatics, pasture grasses, agricultural weeds,
       protected species, and invasive species (EU Union list + BfN lists)
     - INCLUDE: natives + a curated set of non-invasive ornamentals
  3. Check each candidate against the live catalogue (by Latin name)
     - already present  → mark as "existing / conflict", never auto-overwrite
  4. AI trait inference (one Claude call per species)
     - fills the traits FloraWeb lacks: sun, soil, moisture, mature size,
       maintenance, hardiness zone, care notes
     - returns a confidence signal per survival-critical trait
     - grounded with FloraWeb's ecological light/moisture values
  5. Validate every value against the app's plant vocabulary
     - anything outside the allowed buckets is rejected/flagged, never written
  6. Write the staging file
     - natives listed first
     - low-confidence survival-critical fields flagged "must review"

          ⇩   CURATOR opens the staging file, corrects survival-critical
              fields, and sets  approved: true  on the rows they trust

STEP 2 — Commit                (curator runs:  npm run import:plants:commit)
  1. Read the staging file; take only rows marked approved
  2. Re-validate every field against the plant vocabulary (server-side)
  3. Add to the catalogue: insert by Latin name; if the plant already
     exists, skip it (never clobber an admin's edits)
  4. Record where each plant came from + which traits are still AI-guessed
  5. Print a report: inserted / skipped-as-existing / rejected (with reasons)
```

The two steps are separate on purpose: **nothing an AI guessed reaches a real user's plan until a human
has approved it.** That human gate is the whole point — the traits being inferred (does this plant
survive in shade? in wet soil?) are the ones that decide whether a recommended plant lives or dies.

### Where the species list + native status come from
Research compared the open sources and settled the source strategy:
- **The species list, names, and native status come from openly-licensed data** — GBIF (using only its
  CC0/CC-BY datasets) for the German species list and native/introduced flag, cross-checked against
  POWO/WCVP (Kew, CC-BY) for native range, with World Flora Online (CC0) normalizing the names and
  Wikidata (CC0) supplying German common names. **All of these permit commercial redistribution of the
  derived data with attribution** — which is the crucial difference from FloraWeb.
- **FloraWeb / GermanSL / BiolFlor are kept only as an optional cross-reference** a curator can consult
  during review — their German coverage is excellent, but their licences are restrictive or unverified,
  so their data is never shipped.
- **No open source — German or otherwise — provides gardening traits** (sun tolerance, garden
  soil/moisture needs, mature size, hardiness zone, care notes). Every source checked stops at
  ecological/wild-habitat data. That gap is exactly what the AI step fills, and confirms the design's
  central bet.

> **Per-dataset licence check is mandatory.** GBIF and Catalogue of Life licences are set per dataset,
> not globally — a German checklist mirrored there could itself be non-commercial or trace back to a
> restricted source. The importer filters to CC0/CC-BY and records each row's source dataset + licence.

> **Review guidance (for the curator and `/qa`).** GBIF's German native-status coverage is
> **heterogeneous** — it aggregates many checklists of differing quality, some tracing back to BfN. So
> the `native` flag is *not* fully settled by the import the way a single authoritative source would
> settle it; treat it as a value that needs the same curator attention as the survival-critical AI
> traits. Two implications: (1) cross-checking against POWO/WCVP native range is what raises confidence
> in the flag, and consulting FloraWeb's `Floristischer Status` as an (unshipped) cross-reference is
> worthwhile when the two disagree; (2) the first review session should budget for verifying native
> status, not just the AI-inferred gardening traits.

### Data model changes (plain language)
All additions are **backward-compatible** — the ~40 existing rows and every current read keep working
unchanged. Each plant gains:

```
Each plant now also records:
- Water needs        — dry, moist, or wet   (populated by the import; new)
- Image credit       — who to attribute the photo to (for CC-licensed images)
- Image license      — the licence the photo is under
- Source             — where this row came from (e.g. hand-seeded vs. FloraWeb import)
- AI-origin traits   — which survival-critical fields are still an AI guess
                       vs. corrected by a human
```

The **staging file** (the curator's working document) holds, per species:

```
- Species identity (Latin + common name) and native status   [from FloraWeb]
- AI-inferred traits (sun, soil, water, size, maintenance, zone, notes)
- A confidence signal on the survival-critical traits
- A "must review" flag where confidence is low
- An "approved" flag the curator flips to true
- A source marker
```

### Key technical choices, in brief (the "why", not the "how")
- **Two offline scripts, not an app feature.** Reuses the existing safe, server-side seed model; keeps
  the review outside the app entirely. No new screens, routes, or database security rules.
- **AI fills only the missing gardening traits.** The open-data stack is authoritative on *which*
  species and *native vs. not*; the AI never overrides those. It only infers the horticultural traits
  no open source (German or otherwise) reliably carries — which is also what sidesteps the licensing
  block on buying a trait database.
- **The AI is boxed into the app's own vocabulary.** It can only return values the app already
  understands (the same sun/soil/water/size/zone/maintenance choices the admin form uses), so a
  nonsensical or out-of-vocabulary trait is rejected at the source rather than silently stored.
- **Confidence gates the survival-critical fields.** If the AI is unsure about sun, soil, water, or
  hardiness for a species, that row cannot be committed until a human resolves it.
- **Provenance is tracked per field.** Each committed plant records not just "came from the import" but
  *which* survival traits are still AI guesses — so they can be re-verified later without re-checking
  everything.
- **Re-running is always safe.** Commit adds new species by Latin name and skips any that already
  exist, so it never creates duplicates and never overwrites a correction an admin made in
  `/admin/plants`.
- **Images stay external URLs** (as today); this feature only stores the attribution/licence alongside
  them, for a later display-side follow-on.

### New dependencies & configuration
- **`@anthropic-ai/sdk`** — the Anthropic client for the AI trait-inference step (new; not currently
  installed).
- **A small file parser** for the human-readable staging file (a YAML reader).
- **`ANTHROPIC_API_KEY`** — new environment variable, needed only on the curator's machine when running
  the import. Like the existing service-role key, it is a server-side secret and never reaches the
  browser. To be documented in `.env.local.example`.
- Reuses the existing `@supabase/supabase-js` client and `SUPABASE_SERVICE_ROLE_KEY`.

### Downstream note (out of scope here, flagged for PROJ-6)
This feature *adds and populates* the new `water needs` field and *records* the native flag honestly and
surfaces natives first — but wiring `water needs` into the plan engine's survival filter, and weighting
natives in plant selection, are separate PROJ-6 enhancements, not part of this work.

### The one thing to confirm before building
Leading with the open-data stack **removes the FloraWeb licensing block** as a gating risk: GBIF
(CC0/CC-BY), POWO/WCVP (CC-BY), WFO and Wikidata (CC0) all permit commercial redistribution of derived
data with attribution, the AI infers the traits, and the invasive lists are freely-reusable EU/BfN
sources. What remains is a smaller, mechanical check rather than a legal negotiation: **the importer
must verify each GBIF/CoL dataset's licence per pull** (they are set per dataset, not globally) and
filter to CC0/CC-BY, recording each row's source and licence. See Open Questions.

## Backend Implementation (2026-07-06)

Built as two offline Node scripts extending the `seed:plants` pattern — no new UI, API
routes, or RLS (as the Tech Design specifies). Server-side only (service-role +
Anthropic key), never runs in the browser.

### What was built
- **Migration** `supabase/migrations/20260706120000_proj11_plants_catalogue_etl.sql` —
  additive, backward-compatible columns on `public.plants`: `moisture`
  (`dry`/`moist`/`wet` check), `image_attribution`, `image_license`, `source`, and
  `ai_origin_fields text[]` (constrained to the four survival-critical field names).
  All nullable/defaulted; the ~40 existing rows and every PROJ-5/PROJ-6 read are
  untouched. **Apply via the Supabase dashboard SQL Editor** before running commit
  (this project applies migrations by hand, not via the CLI history).
- **Vocabulary** `src/lib/moisture.ts` — the `dry`/`moist`/`wet` bucket set
  (dependency-free, mirrors `soil.ts`). `src/lib/plants.ts` gains `moisture` +
  provenance fields on the `Plant` type (optional/nullable — additive) and on
  `plantSchema` (nullable-optional, so the seed rows and admin form still validate),
  plus `SURVIVAL_CRITICAL_FIELDS` and `moistureLabel`. `image_url` is now
  `.nullable()` to match the nullable column.
- **Pipeline library** (`scripts/lib/`):
  - `catalogue.mjs` — the vocabulary + zod schemas (`importPlantSchema` requires
    moisture; `stagedRowSchema`) + pure logic (`needsMandatoryReview`,
    `orderNativesFirst`, `buildStagedRow`, `planCommit`). Locked to `@/lib/plants` by
    `catalogue.test.ts` (a drift in either side fails the test).
  - `sources.mjs` — live GBIF clients (`gbifMatchSpecies`, `gbifNativeStatus` with a
    per-dataset CC0/CC-BY licence check, `gbifDatasetLicense`) + Wikidata German common
    names. Fails loudly on an unreachable source; common-name lookup degrades to null.
  - `selection.mjs` — curated `CANDIDATE_ALLOWLIST` (~100 German garden species across
    all four layers) + rule-based `passesSelectionFilter` (EU Union list + BfN invasives,
    protected species, aquatic/pasture/weed genera).
  - `ai-traits.mjs` — one Claude call per species via `@anthropic-ai/sdk`
    (`claude-opus-4-8`, adaptive thinking, structured output locked to the vocabulary),
    returning traits + per-field confidence; re-validated with zod for the numeric
    ranges json_schema can't express. `RefusalError` lets one species be skipped
    without aborting the run.
  - `staging.mjs` — human-readable YAML staging file (natives first, review header,
    no anchors/aliases).
- **Scripts** `scripts/import-plants.mjs` (`npm run import:plants` → stage) and
  `scripts/import-plants-commit.mjs` (`npm run import:plants:commit` → commit only
  `approved: true` rows, re-validate server-side, `ON CONFLICT DO NOTHING`, partial-
  commit-safe report). New env var `ANTHROPIC_API_KEY` documented in
  `.env.local.example`; the staging file is git-ignored.

### Tests
5 co-located suites in `scripts/lib/*.test.ts` (49 tests) covering vocabulary parity,
schema validation, the review-gate + approved-only + idempotency commit logic, the
selection filter + allowlist integrity, the GBIF/Wikidata clients (mocked fetch,
including loud-fail and licence gating), AI inference (fake client — out-of-vocabulary
and out-of-range rejection, refusal handling), and the YAML round-trip. Full suite
251 → 300 green; lint + typecheck clean.

### Notes / deviations
- **Source strategy realized as designed:** GBIF (licence-filtered) + Wikidata for
  identity/native/common-name; AI for the horticultural traits; FloraWeb/POWO left as
  the curator's (unshipped) cross-reference. POWO/WCVP has no open API, so native
  status leads on GBIF `establishmentMeans` + the per-dataset licence check — the spec's
  own "native status needs curator attention" caveat applies and is surfaced in the
  staging-file review header.
- **Not yet run against live data / a real key** (needs the curator's `ANTHROPIC_API_KEY`
  + network); the pure pipeline logic is fully test-covered offline. The first live
  `import:plants` → review → `import:plants:commit` run (targeting ~50–80 approved rows)
  is the QA/curator step.
- **Model:** defaults to `claude-opus-4-8` per the Tech Decision; overridable via
  `ANTHROPIC_MODEL`.

## QA Test Results
**Tested:** 2026-07-06 by /qa (QA Engineer + Red-Team)
**Build under test:** working tree (migration + `scripts/lib/*`, `scripts/import-plants*.mjs`,
`src/lib/plants.ts`, `src/lib/moisture.ts`) — not yet committed.

### Nature of this QA
PROJ-11 is an **offline, two-command curator pipeline** with no UI, API route, or RLS surface,
and it has **never been run against a live Anthropic key or live GBIF/Wikidata** (spec §Backend
Notes). So this QA is code-review + offline-logic verification + a security audit, plus a static
check of the Anthropic API contract (the one part that can only be fully confirmed by a live run).
The first live `import:plants → review → import:plants:commit` run remains a **carried-forward
curator/QA step**, and one finding below (BUG-1) gates it.

### Automated suites
| Suite | Result |
|-------|--------|
| `npm test` (Vitest) | **300/300 pass** (incl. 49 new PROJ-11 tests across 5 co-located suites) |
| `npm run lint` (ESLint) | **clean** |
| `npx tsc --noEmit` (typecheck) | **clean** |
| E2E (Playwright) | **N/A** — feature adds no routes/UI; existing specs unaffected (no source touched in `src/app`) |

### Offline behavioral verification (exercised directly, not just via unit tests)
- **Env guards / loud failure:** both scripts exit non-zero and list the exact missing env vars;
  commit on a missing/corrupt staging file throws loudly and writes nothing (ACs: "fails loudly",
  "no partial file"). ✅
- **Review gate (survival-critical):** an `approved: true` row that is also `review_required: true`
  (low AI confidence) is **blocked** from commit (lands in `skippedReview`). ✅
- **Approved-only commit:** unapproved rows are skipped. ✅
- **Idempotency / no-clobber:** existing `latin_name` rows are skipped (`skippedExisting`); the DB
  column is `not null unique` (PROJ-5 migration) so `onConflict:'latin_name', ignoreDuplicates:true`
  = `ON CONFLICT DO NOTHING` is well-founded. ✅
- **Partial-commit safety:** a hand-edited out-of-vocabulary value (`moisture: soggy`) on an
  otherwise valid-shaped row is rejected **per-row with a reported reason**, not the whole batch. ✅
- **Natives-first ordering:** confirmed stable (natives, then alphabetical). ✅

### Acceptance Criteria
**Import (stage):** AC1 staging file w/ provenance+confidence ✅ · AC2 selection filter
(allowlist + EU/BfN invasive + protected + habitat-genus exclusions; allowlist has no
self-conflicts) ✅ · AC3 natives first ✅ · AC4 vocabulary-locked (json_schema enums + zod
re-validation of ranges) ✅ · AC5 low-confidence → mandatory review, blocks commit ✅ ·
AC6 existing marked conflict, not auto-overwritten ✅
**Review + commit:** AC7 approved-only ✅ · AC8 server-side re-validation, partial-safe ✅ ·
AC9 provenance (`source` + `ai_origin_fields`) recorded ✅ · AC10 counts report ✅ ·
AC11 idempotent, no duplicates/clobber ✅
**First batch + effect:** AC12 (~50–80 verified rows) / AC13 (plan variety) / AC14 (image
attribution stored) — **cannot verify without the live run**; machinery is present and correct.
Note: `buildStagedRow` currently always sets `image_url/attribution/license` to null (identity
sources don't fetch images), so AC14's *storage path* exists but is unexercised until images are
sourced. **Not a defect** — matches "images remain external URLs; this feature only stores
attribution metadata."
**Schema:** AC15 additive `moisture`/`image_attribution`/`image_license`/`source`/`ai_origin_fields`,
all nullable/defaulted, CHECKed; existing ~40 rows and PROJ-5/6 reads untouched ✅

### Anthropic API contract (static review vs. claude-api reference)
The AI call in `ai-traits.mjs` is **correct** for `claude-opus-4-8`: `thinking:{type:'adaptive'}`
(not the removed `budget_tokens`), `effort` nested inside `output_config`, structured output via
`output_config.format:{type:'json_schema'}`, and the schema deliberately omits the numeric
`minimum`/`maximum` constraints that structured outputs don't support (ranges are re-checked with
zod afterward). Refusal is handled (`stop_reason==='refusal'` → `RefusalError` → skip one species).
**One risk — see BUG-1.**

### Bugs found
| ID | Sev | Summary |
|----|-----|---------|
| BUG-1 | **Medium** — **FIXED 2026-07-06** | `inferTraits` set `max_tokens: 2048` while running **adaptive thinking at `effort:'high'`**. On Opus 4.8 thinking tokens count against `max_tokens`, so careful per-species reasoning could exhaust the budget before the JSON was emitted → `stop_reason:'max_tokens'` → truncated/empty output → parse/extract failure → species silently skipped as "AI inference failed", risking a high skip rate on the first run. **Fix applied:** default `maxTokens` raised `2048 → 8192`, plus an explicit `stop_reason==='max_tokens'` guard that throws a clear "response truncated — raise maxTokens or lower effort" error instead of a confusing parse failure. Co-located test added (`ai-traits.test.ts`); suite 300 → 301 green, lint clean. Still confirm on a live smoke-test of ~3–5 species before the full run. |
| BUG-2 | Low | `output_config` carries `effort` **and** `format` together. This is a valid combination per the API reference, but the pipeline has never executed it live — **verify on the first real call** that the request isn't rejected; if it is, split the concern or drop `effort`. |
| BUG-3 | Low | `image_url` validation differs between layers: `importPlantSchema` uses a `^https?://` **regex**, while the app's `plantSchema`/`safeImageUrl` use a real `URL()` parser (the PROJ-5 BUG-2 hardening). The regex is looser (accepts malformed authorities) though it still blocks `javascript:`/`data:`. Harmless today (`image_url` is always null from the import), but the two should share `isHttpUrl` so a future image-sourcing step can't stage a URL the app would later reject. |
| BUG-4 | Low | `care_notes` is **AI free-text** (≤2000 chars) committed to `public.plants` and rendered later (PROJ-7 per-plant blurb). Only length is validated. If any downstream view renders it as HTML rather than text it becomes a stored-content vector. Confirm the plan/plant views render `care_notes` as text (they appear to). Display-side, out of this feature's scope — flagged for the consuming view. |

### Security audit (red-team) — no Critical/High findings
- **Secrets:** `ANTHROPIC_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` read only from env via `--env-file`,
  documented in `.env.local.example` with dummy values; `.env*.local` and the staging file are
  git-ignored. No secrets in source. ✅
- **Trust boundary:** service-role client is server-side-only (`.mjs` curator scripts, never bundled
  to the browser); no RLS change; the table's PROJ-5 admin-write policy is unaffected for the app. ✅
- **Prompt-injection surface:** external data reaching the model is the Wikidata German common name
  + the fixed allowlist Latin name. Output is constrained to the vocabulary by `json_schema`, so an
  injected instruction can't produce an out-of-vocabulary trait; only `care_notes` is free-text →
  see BUG-4. Wikidata SPARQL value is quote/backslash-stripped before embedding (allowlist is
  trusted anyway). ✅
- **Licence gating:** per-dataset CC0/CC-BY(-SA) filter drops the native claim when a distribution's
  dataset isn't redistributable (safe, honest fallback) — matches the spec's mandatory per-dataset
  licence check. ✅
- **DoS/rate:** N/A (offline, curator-run, one Claude call per allowlist species).

### Data-quality note (not a bug — carried from the Tech Design)
Native status leans on GBIF `establishmentMeans` + the per-dataset licence check; the
`sourceTaxonKey ? null : datasetKey` guard conservatively drops the licence (→ `native:false`)
whenever a German distribution carries a `sourceTaxonKey`. This may mark many candidates non-native
until a curator confirms. The spec already calls native status a "needs curator attention" field and
surfaces it in the staging review header — **budget the first review session for verifying `native`,
not just the AI traits.**

### Production-ready recommendation: **Ready pending a live smoke-test** (BUG-1 fixed)
No Critical/High defects; all offline logic, ACs, and the security posture pass. **BUG-1 (the
truncation risk that gated the stage step) is now fixed** — `max_tokens` raised to 8192 with an
explicit `max_tokens` stop-reason guard (301/301 tests green, lint clean). The feature's core value
(AI trait inference) still has never executed live, so the remaining gate is operational, not code:
do a **live smoke-test of ~3–5 species** to confirm inference completes end-to-end and that
`output_config` carrying `effort`+`format` is accepted (BUG-2). Once that passes, the pipeline is
ready for the curated stage → review → commit cycle. BUG-3/BUG-4 are Low and can follow.

### Carried forward to the curator/first-run
- Live `import:plants → review → import:plants:commit` targeting ~50–80 approved rows (AC12–14).
- Verify AC13 (PROJ-6 plan variety) after the catalogue grows.
- Source images + attribution to exercise AC14's storage path (currently null).

## Deployment
_To be added by /deploy_
