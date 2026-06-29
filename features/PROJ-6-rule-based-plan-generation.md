# PROJ-6: Rule-Based Plan Generation

## Status: Deployed
**Created:** 2026-06-22
**Last Updated:** 2026-06-29

## Post-Deploy Enhancement — Survival-constraint guardrail (2026-06-29)
Added an explicit, enforced invariant for the failure "the planner recommends a plant that can't survive this site." The engine already only ever selects `matchingSurvivors`, so the property held *implicitly*; this makes it **explicit and independently verified** so a future pipeline regression or a bad catalogue row can't silently leak an unsurvivable plant into a plan.

- **`findConstraintViolations(plan)`** (`src/lib/plan-engine.ts`) — a pure check that re-derives, from the plan's **own `snapshot`** (sun, zone, area), whether every recommended plant clears the hard survival filters (sun tolerance, winter hardiness zone when known, physical fit). It deliberately does **not** call `matchingSurvivors`, so it can't hide behind the same code that produced the plan. A correct plan returns `[]`.
- **Co-located test** (`src/lib/plan-engine.guardrail.test.ts`) — proves the guardrail *detects* (tampered lines for each of sun/zone/fit, plus the zone-unconfirmed exemption) and *prevents* (runs the engine over the **real seed catalogue** across a 252-site matrix of sun × area × zone × surface and asserts zero violations; the matrix count is itself asserted so it can't silently skip).
- **Where it runs:** `npm test` / CI. No DB or schema change, no runtime behaviour change to a correct engine — purely a regression net around the survival promise.

## Dependencies
- Requires: **PROJ-3 (Photo Upload & Space Scan)** — a plan is generated *for a saved scan*. The engine reads the scan's `sun_exposure` (always present — the hard sun filter), `area_sqm` (drives quantities), `surface` (prep note + density), and `space_type` (compact preference). PROJ-3 also rendered the disabled **"Generate plan"** seam on the scan detail that PROJ-6 now wires up.
- Requires: **PROJ-4 (Environmental Data Enrichment)** — the engine reads the scan's enriched `hardiness_zone` (the hard winter filter) and `soil_type` (soft flag + ranking). Per PROJ-4's contract, generation must **never be blocked** by missing/`unavailable` enrichment.
- Requires: **PROJ-5 (Plant Database & Admin Interface)** — the engine matches the seeded, rule-tagged `plants` catalogue (`sun_tolerance[]`, `soil_compatibility[]`, `min_hardiness_zone`, `mature_height_cm`, `mature_spread_cm`, `maintenance_level`, `native`, `image_url`). PROJ-6 also **activates the data-integrity half of PROJ-5's delete-reassignment contract** (see below) and **fixes PROJ-5's carried BUG-1/BUG-2** (`image_url`) because the plant image is first rendered here.
- Requires: **PROJ-2 (User Authentication & Profile)** — the whole flow is behind the auth gate; the engine reads the user's `maintenance_preference` (soft ranking). Plans inherit the owner-only RLS pattern, reached through the scan they belong to.
- **Consumed by: PROJ-7 (Plan Review & Acceptance)** — PROJ-7 makes the read-only plan interactive (the "see more species → select → quantities re-adapt" flow, accept/reject, and the in-app "your plan was updated" notification surface). PROJ-6 specifies and builds the engine + adaptive-quantity logic so PROJ-7 only adds the interaction layer.
- **Consumed by: PROJ-8 (Shopping List & Deep Links)** — reads the plan's per-plant quantities to build a shopping list.

## User Stories
- As **Maya (the Guilty Non-Starter)**, I want to tap "Generate plan" and get a short, ready-made set of plants already sized to my space, so that the planning decision is made *for* me without a wall of choices to wade through.
- As **Thomas (the Pragmatic Rockery Defender)**, I want to see that each recommended plant genuinely suits my sun, my winter zone, and my soil — with an honest flag where the soil might not match — so that I trust the plan is grounded in evidence about *my* spot.
- As a **user whose space is currently gravel or paved**, I want the plan to tell me what preparation it assumes (clear the gravel, add soil or containers), so that the plan is realistic for my starting point and I'm not misled.
- As a **logged-in user**, I want my generated plan saved against my scan, so that I can return to it and later review and accept it (PROJ-7).
- As a **user whose enrichment was incomplete** (soil or zone unavailable), I want a plan generated anyway, with a note about what couldn't be confirmed, so that one missing data source never dead-ends my journey.
- As a **user with a small balcony**, I want compact plants preferred and quantities that fit my square-meterage, so that the plan suits the space I actually have.
- As an **admin who deletes a plant from the catalogue**, I want any plan that used it to be automatically re-pointed to the replacement I chose, so that no user's plan is ever left referencing a missing plant.

## Out of Scope
<!-- What this feature explicitly does NOT cover. Critical for developer handoffs. -->
- **Interactive editing of the plan** — the "see more species → select → quantities re-adapt", swap, add, remove flows are **PROJ-7**. PROJ-6 displays the generated plan **read-only** (plus a read-only "N more plants also suit your space" preview). The adaptive-quantity *logic* is built here so PROJ-7 reuses it.
- **Accepting / rejecting a plan and any "accepted" state** — **PROJ-7**. PROJ-6 only generates, persists, and shows a plan.
- **The in-app "your plan was updated" notification surface** — **PROJ-7** (per PROJ-5's open question, the notification surface is owned there). PROJ-6 implements only the *data* reassignment that keeps `plan_plants` consistent on a plant delete; it does not build any notification UI.
- **Shopping list, garden centre deep links, prices, purchase** — **PROJ-8**. PROJ-6 produces the quantities PROJ-8 consumes; it shows no commerce.
- **AI / LLM plan generation** — v1 is a deterministic rule engine. The output shape is designed so an LLM can augment or replace the engine later (PRD "Plan generation" swap-in point) without changing the schema or the display.
- **A spatial / positional planting layout** (where each plant physically goes) — v1 produces a curated set with quantities, not a placement map. Deferred.
- **Matching on climate beyond hardiness zone** (rainfall, frost days, annual-min temperature as independent filters) — these are displayed as context only; no plant attribute matches them (PROJ-5 deliberately carries no moisture/rainfall attribute). Zone (derived from annual-min temp) is the one climate signal used.
- **Container / compact suitability as a real plant attribute** — the balcony "prefer compact" rule is derived from existing `mature_spread_cm`/`mature_height_cm` size data, not a new flag. *(Note: PROJ-6 **does** add a `plant_type` attribute — groundcover/perennial/shrub/tree — for structural layering; a dedicated container/compact-suitability flag remains a later PROJ-5 catalogue enhancement.)*
- **Plan history / versioning** — one plan per scan; regenerating overwrites it. No version list, no diff, no audit trail of past generations.
- **Auto-regeneration when the scan or enrichment changes** — generation is explicit (the user clicks Generate). Whether to flag a plan as "stale" after a condition change and how to surface that is a PROJ-7 review concern; PROJ-6 simply regenerates on demand and overwrites.
- **Non-Germany support** — inherits the Germany-first scope of PROJ-3/4/5.

## Plant Selection & Plan Composition (product-level — `/architecture` owns the formula constants)

### 1. Hard filters (a plant is excluded if it fails)
- **Winter hardiness:** keep the plant only if `site_zone >= plant.min_hardiness_zone`. *If `hardiness_zone` is `unavailable`, this check is **skipped** (no exclusion on hardiness) and the plan carries a note that winter survival could not be confirmed.*
- **Sun:** keep the plant only if the scan's single `sun_exposure` value is in the plant's `sun_tolerance[]` set (plants tolerate a *range* of light; the site's value must be one of them). Sun comes from the scan and is always present, so this filter always applies.
- **Physical fit:** drop any plant whose **single** mature footprint (`(mature_spread_cm / 100)²` m²) is larger than the scanned area — it cannot fit even once. (Together with the layer gating below, this is why small spaces never get oversized plants or trees.)

Soil is **never** a hard filter (most users don't know their soil — see Product Decisions).

### 2. Structural layers & richness (the ecological model)
The plan is composed as a **layered, biodiverse planting**, not a flat list — following landscape-ecology guidance: a **~10–14 species diversity sweet spot**, a roughly **60% groundcover+perennial / 30% shrub / 10% tree** structure (mimicking natural habitat layers), and **4+ species** as the threshold for real wildlife value.

- **Each plant carries a `plant_type`** — `groundcover` / `perennial` / `shrub` / `tree` (a new PROJ-5 catalogue attribute — see Tech Design).
- **Eligible layers depend on area** (small spaces don't get oversized plants):
  - **groundcover, perennial** — always eligible
  - **shrub** — eligible only when `area_sqm` ≥ ~4 m²
  - **tree** — eligible only when `area_sqm` ≥ ~15 m²
  An ineligible or empty layer's share is **redistributed** to the eligible layers.
- **Target species richness scales with area:** floor **4** (ecological minimum), ceiling **12** (top of the sweet spot, capped for a mobile screen), roughly **+1 species per doubling of area**. It is a *target* — if the catalogue yields fewer survivors, the plan is simply smaller (down to whatever survives; **zero → honest empty state**).
- **Planting area is allocated across the eligible layers ~60/30/10** (groundcover+perennial / shrub / tree); the richness target is distributed across layers in proportion, with **≥1 species per eligible layer that has survivors**.

### 3. Native-first selection within each layer
Within each layer, choose species in this order until the layer's species share is filled:
- **Native survivors first** (`native = true`).
- **Backfill with non-natives only when there aren't enough natives** to fill that layer's share.
- Order by **soil match** (`soil_compatibility[]` contains the site's `soil_type` rank above those that don't; a mismatch **never excludes** — it is **flagged** "may not suit your soil type" and ranked lower; *if `soil_type` is unavailable, no flag and no soil ranking*), then **maintenance match** (`maintenance_level` = the user's `maintenance_preference`; *skipped if none set*), then **compactness** (smaller `mature_spread_cm` boosted when `space_type = balcony`), then a **stable name tiebreak** (determinism).

### 4. Quantities (fill each layer's allocated area at mature spread)
- Per-plant footprint = `(mature_spread_cm / 100)²` m² (plants just touch at maturity — no overlap, no bare gaps).
- Fill **each layer's allocated area** with its chosen species' footprints — even split across the layer's species, remainder to the higher-ranked, **≥1 of each chosen species**.
- **Paved/gravel:** the total is reduced by **×0.5** (feature/container-style planting, not full coverage).
- **Cap:** total plants per plan capped at a sane maximum (**200**) to avoid absurd counts on very large areas; surfaced honestly if applied.

### 5. Determinism
Identical inputs (scan fields + enrichment + catalogue + user preference) **always** yield the same species, layers, and quantities. Regenerating without an input change reproduces the same plan.

### 6. Surface prep note
If `surface = gravel` or `paved`, the plan shows a short prep note (e.g. "This plan assumes you'll clear the gravel and add soil or containers first."). The note never changes which plants are selected.

## Persistence & Regeneration
- **One plan per scan (1:1)** — stored in a new `plans` table with its plant lines in `plan_plants` (each line: the plant + the recommended quantity). This activates PROJ-5's `plan_plants` forward contract.
- **Explicit generation** — the user clicks the (now-enabled) "Generate plan" button on the scan detail. No auto-generation.
- **Regenerate overwrites** — clicking Generate again recomputes and replaces the stored plan and its lines. (Warning the user that this discards any PROJ-7 edits is a PROJ-7 concern.)
- **Ownership & cascade** — plans inherit owner-only RLS reached through the scan (`user_id = auth.uid()`); deleting a scan cascades to its plan and `plan_plants`.

## Delete-Reassignment Contract (activates PROJ-5's forward contract — data-integrity half only)
- When an admin hard-deletes a plant via PROJ-5's existing delete dialog (which already requires choosing a **replacement**), all `plan_plants` rows referencing the deleted plant are **re-pointed to the replacement before the delete**, so no plan is ever orphaned. Quantities are unchanged by a swap.
- The in-app **"your plan was updated" notification** to affected users is **deferred to PROJ-7** (it needs a notification surface PROJ-7 owns).

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Generating
- [ ] Given a logged-in user viewing their own saved scan, when they click "Generate plan", then a plan is generated and they are shown a read-only plan view with the curated set of plants and a recommended quantity for each.
- [ ] Given a scan with no plan yet, when the plan view loads after generation, then it shows the conditions the plan was based on (sun, zone, soil where available) for transparency.
- [ ] Given identical scan, enrichment, catalogue, and maintenance preference, when the user generates the plan twice, then the same species and the same quantities are produced both times (deterministic).
- [ ] Given an existing plan for a scan, when the user clicks "Generate plan" again, then the plan is recomputed and the stored plan is overwritten (one plan per scan).

### Hard filters (survival)
- [ ] Given a plant whose `min_hardiness_zone` is colder-hardy than the site requires (`site_zone >= plant.min_zone`) and whose `sun_tolerance` includes the site's sun, when a plan is generated, then that plant is eligible.
- [ ] Given a plant whose `min_hardiness_zone` is greater than the site zone, when a plan is generated, then that plant is excluded (cannot survive the winter).
- [ ] Given a plant whose `sun_tolerance` does not include the scan's `sun_exposure`, when a plan is generated, then that plant is excluded.
- [ ] Given the scan's `hardiness_zone` is unavailable, when a plan is generated, then the zone filter is not applied (no plant excluded on hardiness) and the plan shows a note that winter survival could not be confirmed.
- [ ] Given a plant whose single mature footprint exceeds the scanned area, when a plan is generated, then that plant is excluded (it cannot physically fit).

### Layers, richness & native-first
- [ ] Given survivors of more than one `plant_type`, when a plan is generated, then it is composed of structural layers (groundcover/perennial/shrub/tree) and presented grouped by layer.
- [ ] Given the scanned area, when a plan is generated, then the target species count scales with area between a floor of 4 and a ceiling of 12 (catalogue permitting).
- [ ] Given an area below the shrub threshold (~4 m²) or tree threshold (~15 m²), when a plan is generated, then no shrubs/trees respectively are included and their area share is reallocated to groundcovers/perennials.
- [ ] Given enough native survivors to fill a layer's species share, when a plan is generated, then that layer contains only natives; non-natives are added only to fill a layer short of natives.
- [ ] Given more survivors than the richness ceiling, when a plan is generated, then the plan is limited to at most 12 distinct species.

### Soil (soft, never excludes)
- [ ] Given the site soil is known and a surviving plant's `soil_compatibility` does not include it, when that plant appears in the plan, then it is shown with a "may not suit your soil type" flag and is ranked below soil-matching plants.
- [ ] Given the site soil is unavailable, when a plan is generated, then no soil flag is shown on any plant and soil does not affect ranking.

### Ranking preferences
- [ ] Given the user has a `maintenance_preference` set, when a plan is generated, then plants whose `maintenance_level` matches that preference are ranked above non-matching plants of the same tier.
- [ ] Given the scan's `space_type` is balcony, when a plan is generated, then more compact plants (smaller mature spread/height) are preferred in the ranking.

### Quantities & surface
- [ ] Given a scan with an `area_sqm` value, when a plan is generated, then each chosen species has a recommended quantity ≥ 1 and the total roughly fills the area at the plants' mature spread.
- [ ] Given the scan's `surface` is gravel or paved, when a plan is generated, then the total quantity is reduced (feature/container density) and a preparation note is shown.
- [ ] Given a very large `area_sqm`, when a plan is generated, then the total quantity is capped at a sane maximum rather than producing an absurd count.

### Read-only "see more" preview
- [ ] Given more plants survive the filters than fit the curated set, when the plan view loads, then a read-only indication of how many additional suitable plants exist is shown (no quantities), with interactive selection deferred to PROJ-7.

### Empty / thin results
- [ ] Given no plants survive the hard filters, when the user generates a plan, then an honest empty state is shown explaining no catalogue plants suit this space's sun and winter conditions yet (with the zone note if zone was missing), and no fabricated plant is shown.
- [ ] Given only one or two plants survive, when a plan is generated, then a plan with just those plants is produced (never padded with plants that fail sun or zone).

### Delete-reassignment (PROJ-5 contract — data integrity)
- [ ] Given a plant referenced by one or more plans, when an admin deletes it with a chosen replacement, then every `plan_plants` row referencing the deleted plant is re-pointed to the replacement before the plant is hard-deleted, and no plan is left referencing a missing plant.
- [ ] Given a plan whose plant was reassigned, when the owner next views the plan, then it shows the replacement plant in place of the deleted one (the in-app notification of this change is delivered in PROJ-7).

### Image safety (PROJ-5 carried BUG-1 / BUG-2)
- [ ] Given a plant with an `image_url`, when it is shown in the plan, then the image renders only when the URL is http(s); a non-http(s) URL (e.g. `javascript:`/`data:`) is not rendered.
- [ ] Given a plant whose `image_url` is empty or the image fails to load, when it is shown in the plan, then a graceful placeholder is shown rather than a broken image.
- [ ] Given the `plants.image_url` column, when a value is written, then a non-http(s) value is rejected at the database (format constraint), not only by client validation.

### Security & ownership
- [ ] Given two users, when A is logged in, then A can generate, view, and store a plan only for A's own scans, never B's (owner-only RLS, reached through the scan).
- [ ] Given an unauthenticated visitor, when they attempt to generate or view a plan, then they are redirected to `/login` (PROJ-2's gate).
- [ ] Given a non-owner, when they send a crafted request to read or write a `plans`/`plan_plants` row they do not own, then it is rejected by RLS at the database.

## Edge Cases
- **Zero survivors** (no plant clears sun + zone + fit) → honest empty state; never fabricate or relax sun/zone to pad the list. Suggest adjusting the scan / checking back as the catalogue grows.
- **Fewer survivors than the richness target** → generate a smaller plan with exactly what survives across the eligible layers; never pad with plants that fail sun/zone/fit.
- **Fewer natives than a layer needs** → backfill that layer with non-native survivors (the case non-natives appear).
- **Area below the shrub (~4 m²) / tree (~15 m²) threshold** → that layer is omitted and its area share is reallocated to groundcovers/perennials (small spaces never get oversized plants or trees).
- **A single plant too large to fit the area** → excluded by the physical-fit rule even if it passes sun/zone.
- **Catalogue too thin to hit ~60/30/10 or the floor of 4** → best-effort: layers/species fill as far as the survivors allow; the ambitious richness is a target the catalogue grows into (the 14 seeded plants will often yield fewer after filtering).
- **Hardiness zone unavailable** → skip the zone filter, generate anyway, show the "winter survival not confirmed" note.
- **Soil unavailable** → no soil flag, no soil ranking; plan still generated.
- **User has no `maintenance_preference`** → skip the maintenance ranking boost; everything else applies.
- **Very small area** (e.g. 1 m²) → quantities still guarantee ≥ 1 of each chosen species (never round a chosen plant to 0).
- **Very large area** → total quantity hits the sane cap rather than producing thousands of plants.
- **Paved/gravel surface** → reduced density + prep note; plant selection unchanged.
- **Plant deleted by admin while a user holds a plan referencing it** → `plan_plants` re-pointed to the admin-chosen replacement before delete; the plan view shows the replacement (notification in PROJ-7).
- **Scan edited/re-enriched after a plan was generated** → the plan is not auto-regenerated; it reflects the inputs at generation time until the user regenerates (staleness surfacing is a PROJ-7 concern).
- **Scan deleted while it has a plan** → plan and `plan_plants` cascade-delete with the scan (no orphans).
- **Plant `image_url` points at a dead/unreachable image** → graceful placeholder (reachability is not validated, per PROJ-5).
- **Catalogue changes between two regenerations** → because generation is deterministic on current inputs, a changed catalogue can legitimately change the plan; this is expected (not a bug).
- **Concurrent regenerations of the same scan's plan from two tabs** → last write wins (consistent with the project-wide v1 stance).

## Technical Requirements (optional)
- **Security:** new `plans` + `plan_plants` tables use the owner-only RLS pattern reached through the scan (`plan_plants` joins through `plans` → `scans` to verify ownership, per the PRD constraint). Explicit `GRANT ... TO authenticated` per the PROJ-2 BUG-7 / PROJ-3 grant convention. The whole flow is auth-gated.
- **Image safety (carried BUG-1/BUG-2):** add a DB-level `check (image_url ~ '^https?://')` on `plants.image_url`; tighten `plantSchema`'s URL validation to http(s) only; render `image_url` exclusively via a safe `<img src>` with an http(s) allowlist and a broken-image fallback.
- **Performance:** generation runs against a few-hundred-row catalogue and must feel instant; matching is simple set/numeric comparison plus a sort.
- **Data alignment:** matching relies on the vocabularies staying in lockstep with PROJ-3 (sun), PROJ-4 (soil, zone), PROJ-5 (plant attributes). Any change to those buckets is a breaking change for matching.
- **AI-ready shape:** the plan output (a set of plants + quantities + reasons/flags) is structured so a future LLM could produce the same shape without schema or UI change (PRD swap-in point).

## Open Questions
<!-- Unresolved questions from the spec interview. Close them in /refine or /architecture when answered. -->
- [x] **Where the read-only plan is displayed** — **RESOLVED (/architecture):** a dedicated route `/scans/{id}/plan`, reachable from the scan's Generate button; PROJ-7 makes it interactive.
- [x] **Exact formula constants** — **RESOLVED (/architecture + review):** layered-ecological model — area-eligible layers (shrub ≥~4 m², tree ≥~15 m²) allocated ~60/30/10 of planting area; species richness scales with area (floor 4, ceiling 12, ~+1 per area doubling); native-first within each layer; per-plant physical-fit exclusion; paved/gravel density ×0.5; total cap 200; ranking a fixed ordered sort (native → soil-match → maintenance-match → compact-if-balcony → name); even quantity split per layer, ≥1 each. Tunable against the seed catalogue.
- [x] **Per-plant "why" presentation** — **RESOLVED (/architecture):** each plant card shows reason chips ("Native", "Matches your low-maintenance preference") plus a soil-mismatch flag where applicable.
- [ ] **Plan staleness after a condition change** — whether/how to flag that a plan no longer reflects an edited scan or re-run enrichment. **Deferred to PROJ-7** (review experience); PROJ-6's conditions snapshot on the `plans` row is what enables it.

## Decision Log
<!-- Record of conscious decisions made and why. Added to by /write-spec and /architecture. -->

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| PROJ-6 = generate + persist + **read-only** display; editing/accept/notifications → PROJ-7 | Keeps PROJ-6 an independently testable/deployable unit (a user can generate and see a real plan) while the interactive review lives in the feature scoped for it (PROJ-7) | 2026-06-22 |
| **Hard filters: hardiness zone + sun only** | These are survival-critical — a plant that fails them dies; recommending it breaks the core promise | 2026-06-22 |
| **Soil is never a hard filter** — mismatch is flagged + ranked lower | Most users don't know their soil; excluding on a value they can't confirm would wrongly shrink results. Transparency (flag) beats silent exclusion | 2026-06-22 |
| **Native-first, tiered:** curated set is natives-only unless fewer than 3 natives survive, then backfill non-natives | Directly serves the PRD's "natives beat gravel" framing (Thomas) and the ecological mission; non-natives are a fallback only when needed to give a usable plan. *Supersedes the earlier "native = ranking boost" note.* | 2026-06-22 |
| **Generation never blocked by missing enrichment** — relax the missing rule (skip zone filter if zone unavailable; no soil flag/rank if soil unavailable), generate anyway, note what couldn't be checked | Honors PROJ-4's no-block contract; keeps Maya moving while staying honest with Thomas | 2026-06-22 |
| ~~**Plan = 3–6 varied species** + per-plant quantities~~ — **SUPERSEDED 2026-06-22 (/architecture)** by the layered-ecological model below | The original small flat set was tuned only for overload avoidance; ecological guidance (10–14 species sweet spot, layered structure) is more on-mission for Sproutly's biodiversity thesis, and *grouping by layer* solves overload better than a small cap | 2026-06-22 |
| **Layered-ecological composition:** structural layers (groundcover/perennial/shrub/tree) at ~60/30/10 of planting area; species **richness scales with area** (floor 4, ceiling 12); plan shown **grouped by layer** | Follows landscape-ecology guidance (diversity sweet spot, habitat layering, 4+ species for wildlife); directly advances the PRD's "ecologically grounded plan" vision and "natives beat gravel" thesis; layer grouping keeps a richer plan scannable rather than overwhelming | 2026-06-22 |
| **Richness scales with area** (~+1 species per doubling, 4→12), quantity ≈ each layer's allocated area ÷ `(mature_spread)²` | Keeps the plan grounded in the real space (Thomas) — a balcony and a 200 m² garden get appropriately different plans — and gives PROJ-8 real shopping quantities | 2026-06-22 |
| **Small areas exclude oversized plants & trees:** shrubs need ~≥4 m², trees ~≥15 m²; any plant whose single footprint can't fit the area is dropped | A tree doesn't belong on a balcony; physical-fit + layer-area gating make the plan realistic for the actual space (PM steer, 2026-06-22) | 2026-06-22 |
| **New `plant_type` attribute added to the PROJ-5 catalogue** (groundcover/perennial/shrub/tree) + admin form field + backfill the 14 seed plants | The 60/30/10 layering needs an accurate structural type; deriving it from height alone misclassifies; a real attribute is the clean foundation for PROJ-6/7/8 (chosen over a height proxy) | 2026-06-22 |
| **No spatial layout in v1** | Placement/zoning is design-heavy and not needed to validate the core Scan→Plan→Order journey; defer | 2026-06-22 |
| **Climate beyond zone (rainfall, frost, min-temp) is context-only, not matched** | No plant attribute maps to them (PROJ-5 carries no moisture/rainfall attribute); matching on them would be unfounded | 2026-06-22 |
| **Surface & space_type as soft signals, grounded in size data** — balcony → prefer compact (low `mature_spread_cm`); paved/gravel → reduce fill density + prep note; never exclude | Acts on the PRD's hardscape-conversion story (Thomas's gravel) and small-space reality without inventing an unbacked container attribute — uses the size data PROJ-5 already stores | 2026-06-22 |
| **One plan per scan, deterministic, regenerate overwrites; no history** | Reproducible results are trustworthy and testable; one plan per scan keeps the model simple; history/versioning is scope creep for v1 | 2026-06-22 |
| **Explicit generation** (button click), not automatic | Matches the existing disabled "Generate plan" seam; a user-initiated action is clearer than silent background generation | 2026-06-22 |
| **Delete-reassignment activates here (data integrity); notification deferred to PROJ-7** | Once `plan_plants` exists, an admin plant-delete could orphan plan rows — the re-point must run now; the notification surface is PROJ-7's per PROJ-5's open question | 2026-06-22 |
| **Fix PROJ-5's carried BUG-1/BUG-2 here** (`image_url` http(s) DB constraint + http(s)-only validation + safe rendering) | PROJ-6 is where the plant image is first rendered, so this is where the validation/rendering risk becomes real | 2026-06-22 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| Two new tables: `plans` (header, 1:1 with scan) + `plan_plants` (lines) | Natural shape for "a plan of several plants with quantities"; matches the PRD's `plan_plants`-through-`plans` ownership rule; `plan_plants` is exactly what PROJ-8's shopping list consumes | 2026-06-22 |
| `plans` carries a **snapshot of the conditions used** (sun, zone/none, soil/none, area, surface, space type, maintenance pref) + a "winter not confirmed" flag + "extra matches" count | Makes the plan view self-contained and honest about what it was based on; gives PROJ-7 a clean basis to detect staleness without re-deriving inputs | 2026-06-22 |
| Owner-only RLS: `plans` keyed on `user_id`; `plan_plants` ownership verified by joining through `plans` → `scans` | Project-wide convention (PROJ-1/3/4); the PRD explicitly requires `plan_plants` to join through `plans` for ownership | 2026-06-22 |
| `plan_plants` → `plants` reference uses **restrict-on-delete** (a referenced plant cannot be plainly deleted) | Enforces PROJ-5's no-orphan contract at the database; forces admin deletes through the safe reassignment function | 2026-06-22 |
| `plans`/`plan_plants` cascade-delete with the scan; explicit `GRANT … TO authenticated`/`service_role` | Inherits PROJ-3's scan-cascade and the PROJ-2 BUG-7 / PROJ-3 grant convention (table privileges don't apply by default) | 2026-06-22 |
| The rule engine is one **shared pure module**, run **client-side** on Generate, results saved via the authenticated browser client | Determinism + direct unit-testability; PROJ-7 reuses the same engine for interactive editing; matches the repo's client-write-via-RLS pattern (scans/plants/profile) and avoids a bespoke generation route | 2026-06-22 |
| Regenerate = replace the scan's existing plan and lines (delete-then-insert); last write wins | One plan per scan with no history (per spec); the brief overwrite window is acceptable for a single-user, single-plan model, consistent with the app's last-write-wins stance | 2026-06-22 |
| Cross-user reassignment isolated to **one admin-only trusted database function** that re-points `plan_plants` to the replacement then deletes the plant, atomically | This is the only action that legitimately crosses ownership boundaries; isolating it keeps owner-only RLS intact everywhere else and makes the privileged path auditable. PROJ-5's delete dialog is switched to call it | 2026-06-22 |
| BUG-2 fix: tighten `plantSchema.image_url` to **http(s) only**; BUG-1 fix: add a **database-level http(s) check** on `plants.image_url`; render images via a safe http(s)-allowlist helper with a placeholder fallback | PROJ-6 is the first feature to render the plant image, so the validation/rendering risk becomes real here; defence at both the form and the database | 2026-06-22 |
| Read-only plan view at a **dedicated route `/scans/{id}/plan`** (resolves Open Question) | Cleaner than cramming a plan onto the scan detail; gives PROJ-7 a natural place to add interactivity | 2026-06-22 |
| **New `plant_type` column** on `plants` (groundcover/perennial/shrub/tree) + admin form field + backfill the 14 seed rows | The 60/30/10 layering needs an accurate structural type; a real attribute beats a height-derived proxy that misclassifies. A small extension to Deployed PROJ-5, done within PROJ-6's build | 2026-06-22 |
| **Layered-ecological engine:** area-eligible layers (shrub ≥~4 m², tree ≥~15 m²) at ~60/30/10 of area; area-scaled richness (floor 4, ceiling 12); native-first *within each layer*; per-plant physical-fit exclusion | Implements the ecological model from review; area gating + fit make small spaces realistic (no trees on a balcony); within-layer native-first keeps the biodiversity thesis while ensuring structure | 2026-06-22 |
| Engine constants: richness 4–12 by area, layers ~60/30/10, paved/gravel density ×0.5, quantity cap 200, ranking a fixed ordered sort (native→soil→maintenance→compact→name), even quantity split per layer | Predictable, testable defaults; ordered sort beats a weighted score for determinism and explainability. Tunable against the seed catalogue | 2026-06-22 |
| No new packages | Engine is plain code; all needed shadcn components + Zod already present | 2026-06-22 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
**Date:** 2026-06-22 — `/architecture` phase.

### Overview
PROJ-6 turns the existing disabled **"Generate plan"** button on the scan detail into a working action, adds a **read-only plan view**, and introduces two new database tables (`plans`, `plan_plants`) to store the result. The actual matching is done by one shared **plan engine** — a pure calculation that takes a scan, its enriched conditions, the plant catalogue, and the user's maintenance preference, and returns a curated set of plants with quantities. Because it's a pure calculation, the same inputs always produce the same plan (trustworthy + easy to test), and **PROJ-7 reuses the exact same engine** for its interactive editing. No new external services and no new packages.

### Screens & Components (what gets built)
```
/scans/{id}   (scan detail — EXISTING; the only change is the button below)
└── "Generate plan" button  → now ACTIVE
      runs the plan engine in the browser → saves the plan → opens the plan view

/scans/{id}/plan   (NEW — read-only plan view, behind the auth gate)
├── Header — space name + "Your planting plan"
├── "Based on your conditions" summary — sun · winter zone · soil
│      (shows "not available" where enrichment is missing)
├── Prep note               — only when surface is gravel/paved
│      ("This plan assumes you'll clear the gravel and add soil or containers first.")
├── "Winter survival not confirmed" note — only when the zone was unavailable
├── Plant list — GROUPED BY LAYER (Trees · Shrubs · Perennials · Groundcovers;
│      empty layers omitted), one card per chosen species:
│      • photo (safe http(s) image, graceful placeholder fallback)
│      • common name + Latin name
│      • recommended quantity ("× 7")
│      • reason chips — "Native" · "Matches your low-maintenance preference"
│      • soil flag — "May not suit your soil type" (only when it mismatches)
├── "N more plants also suit your space" — read-only count
│      (selecting/adding them is PROJ-7; the engine already knows the full list)
├── Empty state — honest message when no plant clears sun + winter, + back to scan
└── "Regenerate" button — recompute and overwrite the saved plan
```
Everything is composed from **already-installed** shadcn components (`card`, `badge`, `button`, `skeleton`, `separator`, `alert`). Nothing custom is recreated.

### Data Model (plain language)
**New `plans` table — one row per scan (1:1).** Each plan holds:
- **Owner** and the **scan** it belongs to (the ownership keys for security).
- A **snapshot of the conditions used** at generation time — sun, winter zone (or "not available"), soil (or "not available"), area, surface, space type, and the user's maintenance preference. This makes the plan view self-contained and lets **PROJ-7 later detect when the scan has changed** (staleness).
- A **"winter not confirmed" flag** (set when the zone was missing).
- The **count of additional matching plants** (for the read-only "N more" line).
- Created / updated timestamps.

**New `plan_plants` table — the lines of a plan.** One row per chosen plant, holding: which **plant**, the **recommended quantity**, a **display order** (so the ranked list shows in a stable order), and whether the **soil flag** applies. Ownership is verified by tracing the line → its plan → its scan (the PRD's "`plan_plants` RLS joins through `plans`" rule).

**Catalogue extension — new `plant_type` on the existing `plants` table.** PROJ-6 adds one attribute to PROJ-5's catalogue: **`plant_type`** = groundcover / perennial / shrub / tree. This is what the 60/30/10 structural layering reads. It's a small extension to the already-Deployed PROJ-5: the new column, a field on the admin add/edit form, and a one-time backfill of the 14 seeded plants. (Chosen over guessing the layer from plant height, which misclassifies.)

**Stored in:** Supabase Postgres, **owner-only Row Level Security** (a user only ever sees or changes their own plans), reached through the scan. **Deleting a scan removes its plan and all its lines** automatically.

**Plant references are protected:** a plant that is used in any plan **cannot be silently deleted** — the database refuses, which is what forces the admin's delete to go through the safe reassignment path below.

### How a plan is generated (plain language)
1. The user taps **Generate plan** on their scan.
2. In the browser, the app reads the **plant catalogue** (every signed-in user may read it), the **scan**, and its **enriched conditions** — all reads the user is already allowed to make.
3. The shared **plan engine** runs:
   - **Exclude** plants that can't take the site's **sun**, can't survive the site's **winter zone**, or are **too large to physically fit** the area. *(If the zone is unavailable, the winter check is skipped and the plan is flagged "winter not confirmed.")*
   - **Choose eligible layers by area** (groundcover/perennial always; shrubs ≥~4 m²; trees ≥~15 m²) and **allocate ~60/30/10** of the planting area across them, redistributing any missing layer's share.
   - **Set a richness target** that scales with area (floor 4, ceiling 12) and split it across the eligible layers.
   - **Within each layer, prefer natives** (add non-natives only to fill a layer short of natives), ordered by soil-match (mismatches sink and get flagged), then maintenance-match, then — for a balcony — compactness.
   - **Compute quantities** by filling each layer's allocated area from each plant's mature spread, **reduced by half for paved/gravel** surfaces, **capped at a sane maximum (200)**, never below one of each chosen plant.
4. The result is **saved** through the same secure, owner-checked database access the app already uses for scans and plants — the old plan for that scan is replaced. The user lands on the **read-only plan view**.

**Where the engine runs:** in the browser, then saved via the authenticated database client — exactly the pattern PROJ-3 (scans) and PROJ-5 (plants) already use. No new server route is needed for generation. The engine lives in one shared module so it can be unit-tested directly and reused by PROJ-7.

### Plant-deletion safety (the one privileged piece)
Re-pointing **other users'** plans to a replacement is the only action that must reach beyond the current user's own rows — so it can't run under normal owner-only security. A single **trusted, admin-only database function** does it atomically: it re-points every plan line from the deleted plant to the admin's chosen replacement, **then** deletes the plant — all in one step, so no plan is ever left pointing at a missing plant. PROJ-5's existing delete dialog is switched to call this function instead of a plain delete. The **"your plan was updated" notice** to affected users is **PROJ-7**.

### Image safety (fixes PROJ-5's carried BUG-1 / BUG-2)
- **Validation tightened:** the plant image URL rule now accepts **http(s) only** (rejecting `javascript:`/`data:`), both in the form and as a new **database-level check** on the column.
- **Safe rendering:** plant images render only through a small helper that shows an http(s) image or a **graceful placeholder** — never an unvalidated or broken image. This is the first feature that actually displays the plant image, which is why the fix lands here.

### Tech Decisions (why, in brief)
- **Two tables, not one** — a `plans` header plus `plan_plants` lines is the natural shape for "a plan containing several plants with quantities," and it's exactly what PROJ-8's shopping list reads. It also matches the `plan_plants`-through-`plans` ownership rule the PRD already specified.
- **Engine as a shared pure calculation** — determinism (same inputs → same plan) makes it trustworthy and testable, and PROJ-7 gets the interactive feature "for free" by calling the same engine.
- **Generate in the browser, save via owner-checked access** — consistent with how every other data write in this app works (scans, plants, profile); avoids a bespoke server route; the database security is the real boundary regardless.
- **One trusted function only for cross-user reassignment** — the single case that legitimately crosses ownership boundaries is isolated to one admin-only, auditable function rather than loosening security anywhere else.
- **Snapshot the conditions on the plan** — keeps the plan view honest and self-contained and hands PROJ-7 a clean way to tell when a plan has gone stale.

### Engine constants (tunable against the seed catalogue)
- **Structural layers:** groundcover/perennial always eligible; **shrubs ≥ ~4 m²**, **trees ≥ ~15 m²**; planting area allocated **~60/30/10** (groundcover+perennial / shrub / tree), missing layers' shares redistributed.
- **Species richness:** floor **4**, ceiling **12**, ~**+1 species per doubling of area**; ≥1 species per eligible layer that has survivors.
- **Native-first within each layer:** non-natives added only to fill a layer short of natives.
- **Physical fit:** drop any plant whose single mature footprint exceeds the scanned area.
- **Paved/gravel density factor:** **×0.5** (feature/container style).
- **Total-quantity cap:** **200** plants per plan.
- **Ranking within a layer = a fixed ordered sort** (not a weighted score, for predictability): native → soil-match → maintenance-match → compact (balcony only) → stable name tiebreak.
- **Quantity split:** even across each layer's chosen species, remainder to higher-ranked, at least one each.

### Dependencies (packages to install)
**None.** The engine is plain application code; all required shadcn UI components and Zod are already present. The only repo additions are the new tables/function/`plant_type` column (migrations), the shared engine module, the plan view, and the BUG-1/BUG-2 image fixes.

### Build split for the next phases
- **`/frontend`:** the active Generate button; the `/scans/{id}/plan` read-only view grouped by layer + its plant cards/notes/empty state; the safe-image helper; the tightened image-URL validation; and the new **`plant_type`** field on the PROJ-5 admin add/edit form + the shared plant contract (type, options, label, schema).
- **`/backend`:** the `plants.plant_type` column + **backfill the 14 seeded plants** (and the seed script); the `plans` + `plan_plants` migration (RLS, grants, indexes, cascade, the no-orphan reference protection); the admin-only reassignment function (and switching PROJ-5's delete dialog to it); the database-level image-URL check.

## Frontend Implementation (Frontend Developer)
**Date:** 2026-06-22 — `/frontend` phase. UI + the pure rule engine complete. **Awaits `/backend`** for the `plans`/`plan_plants` tables, the `plants.plant_type` column + backfill, the admin reassignment function, and the `image_url` DB check — reads/writes error until those migrations are applied (same staged flow as PROJ-2/3/4/5). Build green: `tsc` ✓, `lint` ✓, `next build` ✓, unit **127/127** ✓.

### Files added
- **`src/lib/plan-engine.ts`** — the **pure, deterministic** rule engine (`generatePlan`). Hard filters (sun, winter zone w/ relaxation, physical fit) → area-eligible layers (shrub ≥4 m², tree ≥15 m²) at ~60/30/10 → area-scaled richness (`richnessForArea`, floor 4 / ceiling 12, +1 per doubling from a 3 m² base) → native-first ranking within each layer → quantities filling each layer's area, ×0.5 paved/gravel density, capped at 200. Exported tunable constants. No I/O, no Date/random → reused verbatim by PROJ-7.
- **`src/lib/plan-engine.test.ts`** — 17 tests: each hard filter incl. zone relaxation + physical fit, native-first (both directions), soil flag (on/off), maintenance match, small-area tree gating, quantity ≥1 / paved density / 200 cap, empty results, **determinism**, richness curve.
- **`src/lib/plans.ts`** — the `plans`/`plan_plants` contract (`Plan`, `PlanPlant`, `PlanPlantWithPlant`, table names, `needsPrep`). `plans` carries the conditions snapshot + `zone_unconfirmed` + `extra_match_count`.
- **`src/components/plans/generate-plan-button.tsx`** — client component (Generate + Regenerate). Reads catalogue + the user's `maintenance_preference`, runs the engine, **overwrites** the scan's plan (delete-then-insert `plans` + `plan_plants`), navigates to the plan view. Authenticated browser client; RLS is the boundary.
- **`src/components/plans/plan-view.tsx`** — read-only plan: "Based on your conditions" summary, winter-unconfirmed + surface-prep notes, plants **grouped by layer** (Trees · Shrubs · Perennials · Groundcovers) with quantity, reason chips (Native, maintenance match) + soil flag, the "N more plants" line, and the empty state. Server-rendered; images via the safe http(s) helper with a `Sprout` placeholder fallback.
- **`src/app/scans/[id]/plan/page.tsx`** — the plan view route. Auth-gated; `notFound()` for non-owners; redirects to the scan when no plan exists (also covers the pre-migration state).

### Files changed
- **`src/lib/plants.ts`** — added **`plant_type`** (`PLANT_TYPE_OPTIONS`, `PlantType`, `LAYER_DISPLAY_ORDER`, `plantTypeLabel`/`plantTypePlural`) and made it a required field on `Plant` + `plantSchema`. **BUG-2 fix:** `image_url` validation tightened to http(s) only (`isHttpUrl`); added **`safeImageUrl`** render guard.
- **`src/components/admin/plant-form.tsx`** — new required **Plant type** select (PROJ-5 admin form extension).
- **`src/components/admin/plants-manager.tsx`** — new **Type** column (badge).
- **`scripts/seed-plants.mjs`** — added `plant_type` to all 14 seed plants (1 groundcover, 1 shrub, 12 perennials — perennial-heavy is honest for a starter set). *(Backend still owns the DB column + applying this.)*
- **`src/app/scans/[id]/page.tsx`** — the disabled "Generate plan" seam is now live: `GeneratePlanButton` when no plan exists, else a "View planting plan" link. Tolerates the `plans` table not existing yet.
- **Test fixtures** updated for the required `plant_type` (`plants.test.ts`, `plants-manager.test.tsx`, `seed-plants.test.ts`); the BUG-2 documentation test now asserts `javascript:`/`data:` are **rejected**.

### Deviations / decisions during build
- **Engine + `LAYER_DISPLAY_ORDER` live in `src/lib`** (not a server route) — pure logic, runs client-side on Generate, directly unit-testable, reused by PROJ-7. Matches the repo's client-write-via-RLS pattern.
- **Richness curve:** `+1 species per doubling from a 3 m² base`, clamped [4,12] (e.g. 3 m²→4, 24 m²→7, ~100 m²→9, ≥768 m²→12) — faithful to the spec's "+1 per doubling" language; tunable.
- **Layer-area weights** `{tree:10, shrub:30, perennial:30, groundcover:30}` realise the 60/30/10 (groundcover+perennial = 60); missing layers' weight redistributes automatically.
- **`plant_type` made required now** (not nullable) → rippled into the seed data + three test fixtures, all updated to keep the suite green. Backend backfills the 14 live rows.
- Plant images use a plain `<img>` (consistent with scan/avatar rendering) gated by `safeImageUrl`; broken/blocked URLs fall back to a placeholder.

### Backend contract for `/backend`
- **`public.plants`:** add **`plant_type text not null`** (∈ groundcover/perennial/shrub/tree) + CHECK; **backfill the 14 seeded rows** (per `scripts/seed-plants.mjs`); add the **`image_url` http(s) CHECK** (BUG-1: `image_url is null or image_url ~ '^https?://'`).
- **`public.plans`:** `id uuid pk`, `scan_id uuid` → scans (**unique**, cascade delete), `user_id uuid`, snapshot cols (`snapshot_sun`, `snapshot_area_sqm`, `snapshot_surface`, `snapshot_space_type`, `snapshot_soil` null, `snapshot_zone int null`, `snapshot_maintenance null`), `zone_unconfirmed bool`, `extra_match_count int`, timestamps. Owner-only RLS on `user_id = auth.uid()`; explicit GRANTs.
- **`public.plan_plants`:** `id uuid pk`, `plan_id uuid` → plans (cascade delete), `plant_id uuid` → plants (**on delete restrict** — enforces the no-orphan contract), `quantity int`, `sort_order int`, `soil_flag bool`, `created_at`. RLS joins through `plans` → `scans` for ownership; explicit GRANTs.
- **Reassignment function:** admin-only `SECURITY DEFINER` fn `(plant_id, replacement_id)` that re-points `plan_plants` to the replacement then hard-deletes the plant, atomically. Switch PROJ-5's `delete-plant-dialog.tsx` to call it instead of the plain `delete()`.

## Backend Implementation (Backend Developer)
**Date:** 2026-06-22 — `/backend` phase. Schema + RLS + the reassignment function complete. **Migrations must be applied** to the Supabase project before reads/writes work (staged flow; same as PROJ-3/4/5). Build green: `tsc` ✓, `lint` ✓, `next build` ✓, unit **127/127** ✓.

### Files added
- **`supabase/migrations/20260622100000_proj6_plants_plant_type_and_image_check.sql`** — extends the Deployed PROJ-5 `plants` table: adds **`plant_type`** (nullable → backfills the 14 seeded rows by `latin_name`, any stray row defaults to `perennial` → `NOT NULL` + CHECK ∈ groundcover/perennial/shrub/tree). **BUG-1 fix:** adds `plants_image_url_http_check` (`image_url is null or image_url ~ '^https?://'`).
- **`supabase/migrations/20260622100100_proj6_plans.sql`** — `public.plans` (1:1 with scan via `scan_id UNIQUE`, cascade-delete; conditions snapshot columns + CHECKs mirroring the scan/enrichment vocabularies; `zone_unconfirmed`, `extra_match_count`) and `public.plan_plants` (`plan_id` → plans cascade; `plant_id` → plants **ON DELETE RESTRICT** to enforce the no-orphan contract; `quantity ≥ 1`, `sort_order`, `soil_flag`). Indexes on `plans.user_id`, `plan_plants.plan_id`, `plan_plants.plant_id`. `set_updated_at` trigger on `plans` (reused from PROJ-3). RLS: `plans` owner-only on `user_id` (insert also checks the scan is the caller's); `plan_plants` ownership **joined through `plans`** (the PRD constraint) for all four verbs.
- **`supabase/migrations/20260622100200_proj6_grant_plans_privileges.sql`** — base GRANTs for `authenticated` + `service_role` on both tables (the PROJ-2 BUG-7 convention; RLS narrows from there).
- **`supabase/migrations/20260622100300_proj6_reassign_and_delete_plant.sql`** — `public.reassign_and_delete_plant(target, replacement)`: **SECURITY DEFINER**, gated by an explicit `is_admin()` check, `search_path=''`. Re-points all `plan_plants` from the deleted plant to the replacement, then hard-deletes — atomically. This is the one action that must legitimately cross owner-only RLS (it touches other users' plan lines). `GRANT EXECUTE … TO authenticated` (the in-function admin check is the real gate).

### Files changed
- **`src/components/admin/delete-plant-dialog.tsx`** — PROJ-5's plain `plants.delete()` switched to `supabase.rpc('reassign_and_delete_plant', …)`, passing the chosen replacement. Plans are now re-pointed instead of blocked/orphaned. (Removed the now-unused `PLANTS_TABLE` import.)

### Notes / deviations
- **No API routes.** Plan generation runs the pure engine client-side and writes `plans`/`plan_plants` through the authenticated browser client (RLS is the boundary) — the repo's established pattern (PROJ-3/5). The one server-side primitive is the `reassign_and_delete_plant` RPC. So there are no route handlers to integration-test; the **engine unit tests (17)** + the schema/seed tests are the testable backend logic, and the RLS/RPC behaviour is for `/qa`'s two-account harness (as in PROJ-5).
- **No `(plan_id, plant_id)` uniqueness** — keeps the reassignment a pure re-point that never fails when a plan already holds the replacement; de-duping/merging such lines is a PROJ-7 concern (the engine itself never emits a plant twice in one plan).
- **`is_admin()` inside the DEFINER function** correctly authorises the *caller* — it's SECURITY INVOKER and reads `auth.uid()`'s own `users` row, so the original caller's role is what's checked.

### Applied to production Supabase (2026-06-22) ✅
All four migrations applied (SQL editor) and verified via the read-only MCP:
- `plants`: `plant_type` backfilled on all 14 rows (groundcover:1, perennial:12, shrub:1; **0 nulls**); `plant_type` + `image_url` http(s) CHECK constraints present.
- `plans` + `plan_plants`: created, RLS enabled, 4 owner-only policies each (`plan_plants` joined through `plans`); `plan_plants.plant_id` FK is **ON DELETE RESTRICT**; `authenticated` GRANTs present.
- `reassign_and_delete_plant`: present; **EXECUTE revoked from `public`/`anon`**, granted to `authenticated` (follow-up `revoke` run after the advisor flagged 0028).

**Security advisor after apply:** clean except two expected WARNs — **0029** (authenticated may execute the SECURITY DEFINER reassignment fn — *accepted by design*; admins call it via the authenticated client and the fn self-authorises with `is_admin()`), and the pre-existing **leaked-password protection** notice (non-issue for magic-link-only auth, same as PROJ-1/3).

### Notes
- `npm run seed:plants` is **not** re-required (the 14 rows were backfilled in migration 1); re-running stays idempotent and now carries `plant_type`.
- No new environment variables. No Realtime publication needed (the plan view reads server-side; generation navigates + `router.refresh()`).

## QA Test Results
**Date:** 2026-06-22 · **QA:** `/qa` pass 1 · **Build:** unit **131/131** ✓, E2E **71/71** ✓, `lint` ✓, `tsc` ✓

### Verdict: ✅ Production-ready (no Critical/High/Medium bugs) — 1 test-only regression found & fixed during QA; 2 INFO items.

### Test assets added
- `src/lib/plan-engine.test.ts` — 17 tests (from `/frontend`): every hard filter incl. zone relaxation + physical fit, native-first (both directions), soil flag on/off, maintenance match, small-area tree gating, quantities/density/cap, empty results, determinism, richness curve.
- `src/lib/plan-engine.catalogue.test.ts` — **4 new** integration tests running the engine against the **real 40-plant seed catalogue**: sane layered plan for a medium garden, balcony stays tree-free + prep note, zone-unavailable still generates, determinism on real data.
- `tests/PROJ-6-plan-routes.spec.ts` — browser route protection: unauthenticated `/scans/[id]/plan` → `/login?returnTo=…` (Chromium + Mobile Safari).
- `tests/PROJ-6-plans-rls-isolation.spec.ts` — **10** two-account tests (admin + regular user): own-plan create; B cannot read/insert/update/delete A's plan or lines; B cannot create a plan against A's scan; RESTRICT FK blocks a plain delete of a referenced plant; non-admin cannot call the reassignment RPC; same-plant replacement rejected; admin reassignment re-points lines then deletes (no orphan).

### Acceptance criteria
| Area | Criterion | Result | How verified |
|---|---|---|---|
| Generating | Generate → read-only plan with curated plants + quantities | ✅ | code review + engine tests + catalogue test |
| Generating | Deterministic (same inputs → same plan) | ✅ | **engine test** + **catalogue test** |
| Generating | Regenerate overwrites (one plan per scan) | ✅ | code review (delete-then-insert) + `scan_id` UNIQUE |
| Hard filters | Sun mismatch excluded | ✅ | **engine test** |
| Hard filters | Too-cold zone excluded; **zone unavailable → relaxed + note** | ✅ | **engine + catalogue tests** |
| Hard filters | Plant too large to fit excluded | ✅ | **engine test** |
| Layers/richness | Grouped by layer; richness scales 4–12 with area | ✅ | engine + **catalogue test** (multi-layer) |
| Layers/richness | Small area omits shrubs/trees, share reallocated | ✅ | **engine + catalogue tests** (balcony tree-free) |
| Native-first | Layer uses natives; non-natives only backfill a short layer | ✅ | **engine test** (both directions) |
| Soil | Mismatch flagged + down-ranked; unavailable → no flag | ✅ | **engine test** |
| Ranking | Maintenance match boosts; balcony prefers compact | ✅ | **engine test** |
| Quantities | ≥1 each; paved/gravel ×0.5; cap 200 | ✅ | **engine test** + catalogue cap check |
| Empty/thin | 0 survivors → honest empty state; thin → smaller plan | ✅ | **engine test** + `PlanView` empty state (code review) |
| Reassignment | Plant delete re-points `plan_plants` to replacement, no orphan | ✅ | **RLS harness** ★ |
| Image safety | Non-http(s) `image_url` rejected (schema + DB CHECK); safe render | ✅ | `plants.test.ts` + DB `plants_image_url_http_check` (MCP) + `safeImageUrl` (code review) |
| Security | Owner-only plans/lines; B can't touch A's; can't plan vs A's scan | ✅ | **RLS harness** (two accounts) ★ |
| Security | Unauthenticated → `/login` | ✅ | **E2E** (2 browsers) |
| Security | Non-admin cannot reassign/delete plants | ✅ | **RLS harness** (RPC + plain delete) ★ |

### Edge cases
All spec edge cases pass or are by-design: zero survivors → empty state (engine test); thin/fewer-than-target → smaller plan; fewer natives → non-native backfill (engine test); zone/soil unavailable → relax/no-flag (engine + catalogue tests); small area → no shrubs/trees (catalogue test); single plant too big → excluded (engine test); paved/gravel → ×0.5 + prep note (catalogue test); plant deleted while referenced → reassigned (harness); deterministic re-runs (engine + catalogue tests). Scan-delete cascade to plan/lines is enforced by FK `on delete cascade` (verified structurally via MCP).

### Security audit (red team)
- ✅ **Owner-only authorization at the DB** — the RLS harness proves user B cannot read, insert, update or delete user A's plan or plan lines, and cannot create a plan against A's scan (`with_check` + the `plan_plants`-through-`plans` join). The real boundary, not just the UI.
- ✅ **No-orphan contract enforced** — `plan_plants.plant_id` is `ON DELETE RESTRICT` (a plain delete of a referenced plant returns `23503`), and the admin-only `reassign_and_delete_plant` re-points lines before deleting. Both proven in the harness.
- ✅ **Privileged function is locked down** — `reassign_and_delete_plant` is `SECURITY DEFINER` with `search_path=''`, gated by an in-function `is_admin()` check (a non-admin call is rejected; harness-proven), and `EXECUTE` was **revoked from `anon`/`public`** (advisor 0028 cleared). The remaining advisor **0029** (authenticated may execute) is accepted by design — admins call it via the authenticated client and the function self-authorises.
- ✅ **BUG-1/BUG-2 fixed (image XSS surface)** — `image_url` is http(s)-only at both the Zod schema and a DB CHECK (`plants_image_url_http_check`, MCP-verified); the plan view renders images only via the `safeImageUrl` http(s) guard with a placeholder fallback; no `dangerouslySetInnerHTML`. `javascript:`/`data:` URLs are rejected (unit test).
- ✅ **No secret exposure** — the service-role key appears only in server/Node code (seed script); plan generation uses the anon browser client; RLS is the boundary. Grep-confirmed.
- ✅ **Supabase security advisor** — only the two accepted WARNs above (0029 by design; pre-existing leaked-password notice, a non-issue for magic-link auth).
- ℹ️ **INFO** — plan generation runs client-side, so a user can write arbitrary quantities/selections to **their own** plan via the browser client. No cross-user impact (own data only; consumed only by their own PROJ-7/8), so not a vulnerability — noted for awareness.

### Bugs found
- **REG-1 (Low, test-only — FIXED during QA):** the PROJ-5 RLS harness `newPlant()` fixture predated `plant_type`, so its admin-insert failed the new `NOT NULL` constraint (`23502`) once PROJ-6's migration landed. Fixed by adding `plant_type: 'perennial'` to the fixture. Not a product bug — the real admin form already sends `plant_type`; this was a stale test fixture surfaced by the schema change. PROJ-5 harness now green (9/9).

### Regression
Full E2E (71) + unit (131) suites green. PROJ-2/3/4/5 routes, RLS isolation, storage isolation, and the role-escalation guard all unaffected. The only shared-surface change is PROJ-5's delete dialog now calling the reassignment RPC (covered by the harness) and the additive `plant_type` admin field/column.

### Residual risk / notes for `/deploy`
- The **authenticated browser UI** for generation (click "Generate plan" → write → land on the grouped plan view, and "Regenerate") is validated by code review + the engine/RLS tests, **not** by an authenticated browser E2E — consistent with the repo's pattern (PROJ-3/5 deferred their authenticated UI the same way). **Recommended:** a manual smoke at deploy — sign in, generate a plan on a real scan, confirm the layered grouping/quantities/notes render and persist, then regenerate.
- All four migrations are already applied to production and the 40-plant catalogue is loaded (verified via MCP), so the manual smoke can run against live data immediately.

## Deployment

**Deployed:** 2026-06-22
**Platform:** Vercel (auto-deploy from `main` — same project as PROJ-1/2/3/4/5)
**Tag:** `v1.6.0-PROJ-6`

### Pre-deploy gates (all green)
- `npm run build` clean (Next 16.1.1, Turbopack); `/scans/[id]/plan` compiles as a dynamic server route
- `npm run lint` clean · `tsc --noEmit` clean
- Unit **131/131** ✓ · E2E **71/71** ✓ (no regressions in PROJ-2/3/4/5)
- No secrets in the committed diff (service-role key referenced only via `process.env` in the seed script)
- QA: **Approved** — no Critical/High/Medium bugs (one test-only regression fixed during QA)

### Database changes (already applied to production Supabase, 2026-06-22, verified via MCP)
1. `20260622100000_proj6_plants_plant_type_and_image_check.sql` — `plants.plant_type` (+ backfill of all rows) + `image_url` http(s) CHECK
2. `20260622100100_proj6_plans.sql` — `plans` + `plan_plants` tables, RLS, indexes, `updated_at` trigger
3. `20260622100200_proj6_grant_plans_privileges.sql` — table GRANTs
4. `20260622100300_proj6_reassign_and_delete_plant.sql` — admin-only reassignment function (`EXECUTE` revoked from `anon`/`public`)
5. Catalogue expanded to **40 plants** via `npm run seed:plants` (NaturaDB-sourced natives; layer mix groundcover:3 / perennial:19 / shrub:10 / tree:8)

Security advisor after apply: only the two accepted WARNs (0029 — authenticated may execute the admin-gated DEFINER fn, by design; pre-existing leaked-password notice).

### Env vars
No changes — reuses the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Post-deploy verification (recommended — manual)
- [ ] Sign in → open a scan → "Generate plan" → the read-only plan view loads with plants **grouped by layer** + quantities; conditions summary + any notes render
- [ ] "Regenerate plan" reproduces the same plan (deterministic) and overwrites
- [ ] Admin: delete a catalogue plant that a plan uses → the plan re-points to the chosen replacement (no orphan)
- [ ] No browser-console or Vercel function-log errors

### Carried forward
- **Forward contract for PROJ-7:** the interactive "see more species → select → quantities re-adapt", accept/reject, and the in-app "your plan was updated" notification (the engine + delete-reassignment are wired and dormant-ready).
