# PROJ-11: Expand Plant Catalogue via FloraWeb/BfN ETL with AI-Assisted Trait Mapping

## Status: Architected
**Created:** 2026-07-06
**Last Updated:** 2026-07-06

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

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
