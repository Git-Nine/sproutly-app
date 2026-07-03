# PROJ-7: Plan Review & Acceptance

## Status: Deployed
**Created:** 2026-06-22
**Last Updated:** 2026-06-22

> **Naming note:** the roadmap name is "Plan Review & Acceptance," but there is **no explicit Accept step** (see Product Decisions — minimal friction). "Acceptance" happens implicitly when the user proceeds to **Order** (the handoff to PROJ-8). The feature is really *Plan Review & Edit + the Order seam + staleness*.
>
> **Split note (2026-06-22):** the "your plan was updated" reassignment **notification** surface was moved out to **PROJ-10 (In-App Notifications)**. PROJ-7 keeps plan editing, the Order seam, staleness, and the duplicate-line merge.

## Dependencies
- Requires: **PROJ-6 (Rule-Based Plan Generation)** — PROJ-7 makes PROJ-6's **read-only** `/scans/[id]/plan` view **interactive**. It reuses PROJ-6's pure `plan-engine` for quantity re-adaptation and reads the `plans` **conditions snapshot** (for staleness).
- Requires: **PROJ-5 (Plant Database & Admin Interface)** — added plants come from the `plants` catalogue (matching survivors only).
- Requires: **PROJ-3 (Photo Upload & Space Scan)** — the plan belongs to a scan; correcting a scan is what makes a plan stale.
- Requires: **PROJ-2 (User Authentication & Profile)** — owner-only access; the whole flow is behind the auth gate.
- **Consumed by: PROJ-8 (Shopping List & Deep Links)** — wires the **"Order these plants"** seam PROJ-7 renders; reads the (possibly edited) plan's plant lines + quantities.
- **Consumed by: PROJ-9 (Progress Photo Log)** — depends on a reviewed/ordered plan existing.
- **Related: PROJ-10 (In-App Notifications)** — surfaces the admin-reassignment "your plan was updated" notice as a banner on this plan view + a My Spaces indicator. PROJ-7 renders the plan correctly (incl. the duplicate-line merge); PROJ-10 owns the notice.

## User Stories
- As **Maya (the Guilty Non-Starter)**, I want to glance at my generated plan and tap one button to order it, so that committing takes almost no effort or decision-making.
- As **Thomas (the Pragmatic Rockery Defender)**, I want to adjust quantities and swap plants to match my own judgement before I order, so that the plan reflects what I actually intend to plant.
- As a **logged-in user reviewing my plan**, I want to see the other plants that also suit my space and add the ones I like, so that I'm not limited to the initial curated set.
- As a **user who corrected my space's details after generating a plan**, I want to be told the plan is now out of date and be offered to regenerate it, so that I don't order plants chosen for the wrong conditions.
- As a **returning user**, I want my edits to my plan to be saved automatically and still there when I come back, so that I never lose my curation.

## Out of Scope
<!-- What this feature explicitly does NOT cover. Critical for developer handoffs. -->
- **The shopping list, garden centre deep links, prices, quantities-to-buy, purchase** — **PROJ-8**. PROJ-7 renders the **"Order these plants"** CTA as a disabled seam (marked as the next step); PROJ-8 wires its destination. PROJ-7 builds no ordering/shopping/checkout UI.
- **The matching/generation algorithm itself** — **PROJ-6**. PROJ-7 *reuses* the engine (for quantity re-adaptation and Regenerate); it does not change the hard filters, layering, or ranking.
- **Adding plants that don't suit the site** — only the engine's **matching survivors** (passed sun/zone/fit) can be added. No whole-catalogue add (would reintroduce unviable plants the engine deliberately excludes).
- **An explicit Accept/Reject state or approval workflow** — dropped for minimal friction; proceeding to Order is the implicit acceptance. There is no "accepted" status on a plan.
- **The "your plan was updated" reassignment notification** (records, banner, My Spaces indicator, any inbox/bell/push) — **PROJ-10 (In-App Notifications)**. PROJ-7 only renders the plan correctly after a reassignment (the duplicate-line merge, below).
- **Analytics / measuring "acceptance rate" and "plan→order conversion"** — those PRD metrics are measured from the Order action, but there is no analytics surface in v1; instrumentation is deferred.
- **Auto-regeneration on staleness** — never silent; Regenerate is always user-initiated.
- **Editing the plan's *conditions*** (sun/soil/zone/area) inside the plan — those live on the scan (PROJ-3); editing the scan is what triggers staleness here.
- **Positional / spatial planting layout** — still deferred (as in PROJ-6).
- **Multi-user collaboration / sharing a plan** — not in v1.
- **Live (real-time) push of a reassignment while the user is viewing** — v1 shows the notice on next load/refresh; Realtime is deferred.

## Plan States & The Order Handoff
- A plan has **no explicit accept/reject state**. From generation onward it is simply an **editable plan**.
- The plan view (`/scans/[id]/plan`, built read-only by PROJ-6) becomes **editable in place**.
- A primary **"Order these plants"** CTA is the single forward action — rendered as a **disabled seam** ("Shopping list coming soon") in PROJ-7, wired by PROJ-8. Proceeding to Order is the implicit acceptance.
- The Order CTA is **not blocked** by a stale plan or an outstanding "updated" notice (minimal friction); it is unavailable only when the plan is **empty** (no plants).

## Editing the Plan
- **Remove** any plant (line removed).
- **Add** a plant from the engine's **matching survivors** — the "N more plants also suit your space" list (PROJ-6's read-only preview) becomes an interactive, searchable add list. Only plants that passed the site's sun/zone/fit are offered.
- **Adjust quantity** via a per-plant **stepper**.
- **Swap** = remove one + add another (no separate swap control needed).
- **Auto-save:** every edit (add / remove / quantity / pin) **persists immediately** to the plan — no Save button; the plan is the same across sessions and devices.

### Quantity behaviour — auto-rebalance with manual pins
- The engine seeds each plant's initial quantity (PROJ-6).
- A quantity the user sets with the stepper becomes **pinned** — kept exactly, and excluded from rebalancing.
- When the **set changes** (add/remove), the engine **rebalances the un-pinned plants** to fill the remaining area (the pinned plants' allocation is held aside). Pinned values never move on their own.
- The global **200-plant cap** (PROJ-6) still applies as a guard.

## Plan Rendering & Staleness
### Duplicate-line merge (plan rendering correctness)
- If a plan ends up containing the **same plant twice** — which a PROJ-6 admin reassignment can cause (the replacement was already in the plan) — PROJ-7's plan view **merges the two lines** (sums quantities) so the user never sees a duplicate. This resolves PROJ-6's deferred de-dupe note. (The *notification* about that reassignment is PROJ-10's job.)

### Staleness notice
- The plan's stored **conditions snapshot** is compared against the scan's **current** matching inputs (sun, zone, soil, area, surface, space type, maintenance preference). If any differ, the plan is **stale**.
- A **dismissible banner** on the plan offers **Regenerate**. Cosmetic scan changes (name, photo) do **not** make a plan stale.
- **Regenerate** rebuilds the plan from current conditions via the engine and **discards manual edits/pins** — so it is user-initiated and **confirmed** first. It never runs automatically and never blocks Order.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Editing
- [ ] Given a user viewing their own plan, when the page loads, then the plan is editable in place (remove controls, an add affordance, and a per-plant quantity stepper are shown).
- [ ] Given a plan with un-pinned plants, when the user removes a plant, then it is removed and the remaining un-pinned plants' quantities rebalance to fill the area.
- [ ] Given more matching plants exist than are in the plan, when the user opens the "more plants suit your space" add list, then those matching survivors (not already in the plan) are listed and can be added; when one is added, then it appears with an engine-computed quantity and the un-pinned plants rebalance.
- [ ] Given a plant in the plan, when the user changes its quantity with the stepper, then that plant becomes pinned and keeps that exact quantity through subsequent add/remove operations.
- [ ] Given some pinned and some un-pinned plants, when the set changes, then only the un-pinned plants' quantities change; pinned ones are untouched.
- [ ] Given the user is editing, when any add/remove/quantity change is made, then it is saved automatically and is still present after a page reload (no Save action required).
- [ ] Given the catalogue contains plants that do not suit the site, when the user opens the add list, then those non-matching plants are not offered.

### Order seam
- [ ] Given a plan with at least one plant, when the plan view loads, then a primary "Order these plants" CTA is shown, marked as the next step and disabled (seam for PROJ-8).
- [ ] Given a plan with no plants, when the plan view loads, then the Order CTA is not available and an empty state is shown.

### Plan rendering
- [ ] Given a plan contains the same plant twice (e.g. after a PROJ-6 admin reassignment), when the plan is viewed, then the duplicate lines are merged into one (summed quantity), so no plant appears twice. *(The notification about that reassignment is PROJ-10.)*

### Staleness
- [ ] Given a plan whose scan matching-input has changed since generation, when the owner views the plan, then a dismissible "your space changed — regenerate" banner is shown.
- [ ] Given only a cosmetic scan change (name or photo), when the owner views the plan, then no staleness banner is shown.
- [ ] Given a stale plan, when the user chooses Regenerate and confirms, then the plan is rebuilt from current conditions, manual edits are discarded, and the staleness banner clears.
- [ ] Given a stale plan, when the user proceeds, then Order is still available (staleness does not block it).

### Security & ownership
- [ ] Given two users, when A is logged in, then A can only view, edit, and order A's own plans, never B's (owner-only RLS, reached through the scan).
- [ ] Given an unauthenticated visitor, when they open a plan or its edit actions, then they are redirected to `/login`.
- [ ] Given a non-owner, when they send a crafted request to edit a plan's lines, then it is rejected by RLS at the database.

## Edge Cases
- **Removing the last plant** → the plan becomes empty; the Order CTA is unavailable and an empty state invites re-adding a plant or regenerating.
- **Editing an empty plan** (zero survivors from generation) → nothing to add (the matching list is empty); show the empty state + Regenerate; no Order.
- **All plants pinned, then one added** → no un-pinned plants to rebalance; the new plant enters at its engine-computed quantity and the pinned ones stay; the area may slightly over/under-fill (accepted — the user is in control).
- **Pinned quantities exceed the area** → allowed (manual override wins); only the 200-plant total cap guards against absurd totals.
- **Concurrent edits to the same plan in two tabs** → last write wins (project-wide v1 convention).
- **A plan reassigned by an admin while it also has duplicate lines** → the duplicate-line merge applies on next load (the *notice* of the reassignment is PROJ-10).
- **PROJ-7's staleness banner and PROJ-10's reassignment banner at the same time** → independent; both can show; neither blocks Order.
- **Regenerate discards edits** → always confirmed first so the user doesn't lose curation unintentionally.
- **Adding a plant that's in the matching list but whose footprint can't fit once the area is full of pinned plants** → still allowed (it's a matching survivor); rebalancing accommodates within the cap.

## Technical Requirements (optional)
- **Security:** plan edits inherit owner-only RLS reached through the scan; the whole flow is auth-gated.
- **Reuse the engine:** quantity re-adaptation and Regenerate call PROJ-6's pure `plan-engine` (extended to accept a fixed set with pinned quantities) — no second algorithm.
- **Writes via the authenticated browser client** (the repo's established pattern for scans/plants/plan generation); RLS is the trust boundary.
- **Persistence:** `plan_plants` gains a per-line **pinned** flag so manual quantities survive rebalancing and reloads.
- **Performance:** editing/rebalancing runs against a small in-memory set (a few–dozen plants) and must feel instant.

## Open Questions
<!-- Unresolved questions from the spec interview. Close them in /refine or /architecture when answered. -->
- [x] **Exact rebalancing math with pins** — **RESOLVED (/architecture):** un-pinned lines refill the area the pinned ones don't claim, via a `computeQuantities(set, area, surface, pins)` helper extracted from PROJ-6's per-layer footprint maths; reallocation stays per-layer (consistent with generation). Tunable at `/frontend` against real plans.
- [x] **Duplicate-merge timing** — **RESOLVED (/architecture):** merged on read for display; the merged set is written back on the next auto-save (self-healing). No dedicated migration.
- [ ] **Live update of the staleness banner** — whether to use Supabase Realtime so it appears without a reload. Deferred; v1 shows on next load.
- [ ] **Measuring acceptance & conversion** — the PRD metrics depend on instrumenting the Order action; no analytics surface exists in v1. Revisit when analytics is introduced.

## Decision Log
<!-- Record of conscious decisions made and why. Added to by /write-spec and /architecture. -->

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| **No explicit Accept step** — proceeding to Order is the implicit acceptance | Minimum friction is the priority (PM steer); a single "Order" button beats an accept→order two-step. The PRD acceptance metric is measured from the Order action (instrumentation deferred) | 2026-06-22 |
| **Plan view becomes editable in place** (same `/scans/[id]/plan` route) | Reuses PROJ-6's surface; no separate edit screen; least friction | 2026-06-22 |
| **Edit ops: remove, add-from-matching, manual quantity stepper** (swap = remove+add) | Covers real curation needs (Thomas) without a bespoke swap UI; adds limited to matching survivors so plans stay viable | 2026-06-22 |
| **Added plants limited to matching survivors** (not the whole catalogue) | Keeps every edited plan grounded in what survives the site's sun/zone/fit — preserves the engine's survival promise | 2026-06-22 |
| **Auto-rebalance with manual pins** — hand-set quantities are pinned/kept; un-pinned refill the area on set change | Honours both "smart area-fill" and "I want exactly N of this"; the stepper expresses intent that rebalancing must not override | 2026-06-22 |
| **Edits auto-save** (no Save button) | Minimal friction; the plan persists across sessions; avoids an unsaved-changes problem | 2026-06-22 |
| **Reassignment notification surface → split out to PROJ-10** | The notification *system* is a cross-cutting concern, not part of plan review; isolating it keeps PROJ-7 focused (PM decision, 2026-06-22) | 2026-06-22 |
| **Merge duplicate plant lines** in the plan view | The user must never see the same plant twice (a reassignment can cause it); resolves PROJ-6's deferred de-dupe note. Plan-rendering correctness, independent of PROJ-10's notice | 2026-06-22 |
| **Staleness: snapshot-compare → banner + Regenerate; never auto, never blocks Order; cosmetic changes ignored** | Uses PROJ-6's snapshot; user keeps control (Regenerate discards edits, so it's opt-in); transparency without dead-ending the journey | 2026-06-22 |
| **Order CTA = disabled seam for PROJ-8; PROJ-7 builds no shopping UI** | Single-responsibility — mirrors PROJ-3 leaving the Generate seam for PROJ-6; the shopping list & deep links belong to PROJ-8 | 2026-06-22 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| Make the existing `/scans/[id]/plan` view interactive via a new client **`PlanEditor`**; server still does the initial fetch | Reuses PROJ-6's route + presentational pieces; instant interaction needs client state; matches the repo's client-write-via-RLS pattern | 2026-06-22 |
| **One new column `plan_plants.pinned`** (boolean, default false); no new tables | "Pinned" is a property of an existing line; staleness reuses the snapshot already on `plans`. Smallest footprint; existing owner-only RLS on `plan_plants` already covers edits | 2026-06-22 |
| **Extract two pure helpers** from the engine — "matching survivors for a scan" (the add list) and "compute quantities for a fixed set honouring pins" (rebalance); refactor `generatePlan` to use them with no output change | One quantity algorithm shared by generate + rebalance; keeps the engine pure and testable; doesn't disturb PROJ-6's behaviour or tests | 2026-06-22 |
| **Auto-save via targeted writes** to `plan_plants` (add → insert, remove → delete, stepper → update + set pinned, rebalance → update un-pinned), stepper debounced | Minimal friction (no Save button); targeted writes are cheaper than full-replace per keystroke; RLS is the boundary | 2026-06-22 |
| **Staleness computed at load** by comparing the plan snapshot to current scan + enrichment + profile; cosmetic fields excluded | Uses PROJ-6's snapshot; no stored "stale" flag to keep in sync; matching-fields-only avoids false positives on a renamed scan | 2026-06-22 |
| **Regenerate reuses PROJ-6's `GeneratePlanButton`/generate flow** behind a confirm | One build-a-plan code path; PROJ-7 adds only the confirm + the staleness entry point | 2026-06-22 |
| **Duplicate lines merged on read; merged set written back on next save** | The user never sees a plant twice; the write-back self-heals the data over time without a dedicated migration | 2026-06-22 |
| **Order CTA = disabled seam**; no shopping/checkout built here | Single-responsibility; PROJ-8 owns the shopping list & deep links | 2026-06-22 |
| **No new packages, no new server route** | Engine is pure code; all UI components already installed; edits go through the authenticated browser client | 2026-06-22 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
**Date:** 2026-06-22 — `/architecture` phase.

### Overview
PROJ-7 turns PROJ-6's **read-only** plan view (`/scans/[id]/plan`) into an **interactive editor**, reuses PROJ-6's pure **plan engine** for live quantity re-adaptation and Regenerate, and adds two small things: a **"pinned" flag** on each plant line (so hand-set quantities survive rebalancing) and a **staleness** check that compares the plan's stored snapshot against the scan's current conditions. The **"Order these plants"** button is rendered as a disabled seam for PROJ-8. There is **no new external service and no new package**; the only database change is one new column. (The reassignment *notification* is PROJ-10, not here.)

### Screens & Components (what gets built)
```
/scans/{id}/plan   (EXISTING route — becomes interactive)
│  server part: loads plan + lines(+plants) + scan + enrichment + catalogue,
│               computes staleness, merges duplicate lines, builds the "add" list
└── PlanEditor  (NEW client component — replaces the read-only interaction)
    ├── Staleness banner   — shown when the scan's conditions changed since generation
    │     └── [ Regenerate ] → confirm (discards edits) → existing generate flow
    ├── "Based on your conditions" summary        (reused from PROJ-6)
    ├── Plant list — grouped by layer (Trees · Shrubs · Perennials · Groundcovers):
    │     editable card per plant —
    │       • photo · name · reason chips · soil flag   (reused from PROJ-6)
    │       • quantity stepper   (changing it PINS the plant)
    │       • remove (×)
    ├── "Add more plants that suit your space"
    │     └── searchable list of matching survivors NOT already in the plan → add
    ├── Empty state            (no plants → re-add / regenerate)
    └── [ Order these plants ] — primary CTA, DISABLED seam ("coming soon" → PROJ-8)
```
All from already-installed shadcn components (`card`, `badge`, `button`, `command`/`popover` for the add list, `alert` for the banner, plus a small stepper from `button`+`input`). PROJ-6's presentational pieces (plant card, layer grouping, conditions summary, safe image) are **reused**, not rebuilt.

### Data Model (plain language)
- **One new field on each plant line (`plan_plants`): "pinned"** — yes/no, default no. Set to yes when the user changes that plant's quantity by hand; pinned lines keep their exact quantity and are skipped by rebalancing.
- **Everything else is reused.** The plan, its lines, and the **conditions snapshot** PROJ-6 already stores on the plan are exactly what staleness needs — no new tables.
- **Staleness is computed, not stored** — the page compares the plan's snapshot (sun, zone, soil, area, surface, space type, maintenance preference) against the scan's current values + enrichment + the user's profile. Any difference in those matching fields ⇒ the plan is stale. Cosmetic scan fields (name, photo) are ignored.
- **Access:** unchanged — owner-only, reached through the scan; editing writes go through the same owner-checked database access used everywhere else.

### How editing works (plain language)
1. The page loads the plan and, in the browser, the editor holds the plant lines as live state.
2. **Remove** drops a line; **Add** picks from the "more plants that suit your space" list (the engine's matching survivors that aren't already in the plan); the **stepper** changes a quantity and marks that plant *pinned*.
3. After any add/remove, the editor calls the **plan engine** to **rebalance the un-pinned lines** to fill the area the pinned ones don't claim — the same area-fill maths PROJ-6 already uses. Pinned quantities never move on their own.
4. Every change **auto-saves** to the plan's lines through the owner-checked database access (no Save button). Quantity steps are saved with a short debounce; add/remove save immediately.
5. **Regenerate** (offered by the staleness banner) reuses PROJ-6's existing generate flow — it rebuilds from current conditions and replaces the plan, **after a confirmation** because it discards manual edits.

### Reusing & extending the engine
- The plan engine (`plan-engine`, pure + already unit-tested) gains two **pure helpers**, reused by both PROJ-6 and PROJ-7:
  - **"matching survivors for this scan"** — the sun/zone/fit filter, so the editor can list the plants available to add.
  - **"compute quantities for a fixed set, honouring pinned ones"** — the area-fill maths extracted so rebalancing can call it with the user's chosen set + pins.
- PROJ-6's `generatePlan` is refactored to call these same helpers — **no change to its output**, so existing plans and tests are unaffected.

### Duplicate-line merge
- When the plan is read, lines for the **same plant** (which a PROJ-6 admin reassignment can create) are **combined into one** with summed quantity, so a plant never appears twice. The next auto-save writes the merged result back, so the data self-heals.

### Where it runs
- **Initial load is server-rendered** (fast, SEO-irrelevant but consistent): the page fetches everything and computes staleness + the add list.
- **Interaction is client-side** (instant): the editor runs the pure engine in the browser and saves through the authenticated database client — exactly the pattern PROJ-3/5/6 use. **No new server route.**

### Tech Decisions (why, in brief)
- **One new column, not a new table** — "pinned" is a property of an existing plant line; staleness reuses the snapshot already stored. Smallest possible footprint.
- **Editor in the browser, engine reused** — re-adaptation must feel instant, the engine is already a pure, tested module, and client-writes-via-RLS is the established pattern; avoids a bespoke server route and a second quantity algorithm.
- **Auto-save (no Save button)** — minimal friction; the plan is the single source of truth and is always current.
- **Regenerate reuses PROJ-6's generate flow** — one code path for building a plan; PROJ-7 only adds the confirm + the staleness trigger.
- **Order is a disabled seam** — single-responsibility; PROJ-8 owns the shopping list, exactly as PROJ-3 left the Generate seam for PROJ-6.

### Dependencies (packages to install)
**None.** All UI is existing shadcn components; the engine extension is plain code. The only repo additions are the `pinned` column (one migration), the `PlanEditor` client component + the engine helpers, and the staleness/merge logic.

### Build split for the next phases
- **`/frontend`:** the `PlanEditor` (editable cards, quantity stepper, add list, remove, rebalance-on-edit, auto-save, empty state); the staleness banner + Regenerate confirm; the disabled Order seam; the duplicate-merge on display; the engine helpers (`matchingSurvivors`, `computeQuantities` with pins) + the `pinned` field in the shared `plans` contract.
- **`/backend`:** the `plan_plants.pinned` column migration (RLS already covers `plan_plants` for the owner — no new policies). No new routes.

## Frontend Implementation (Frontend Developer)
**Date:** 2026-06-22 — `/frontend` phase. Interactive editor + pure engine helpers complete. **Awaits `/backend`** for the `plan_plants.pinned` column — saving edits errors until that migration is applied (staged flow, same as PROJ-2/3/4/5/6). Build green: `tsc` ✓, `lint` ✓, `next build` ✓, unit **143/143** ✓ (incl. PROJ-6's 22 engine tests — the refactor is output-preserving).

### Files added
- **`src/components/plans/plan-editor.tsx`** — the client editor that replaces the read-only view: conditions card, winter/prep notes, **staleness banner** (with confirmed Regenerate), plant list **grouped by layer** with **editable cards** (quantity − / + stepper that *pins*, remove ×), an **"Add more plants that suit your space"** searchable list (matching survivors not in the plan), the empty state, and the **disabled "Order these plants"** seam. Edits **auto-save** (add/remove immediate, stepper debounced 500ms) by replacing the plan's lines; rebalancing runs the shared engine in the browser.
- **`src/lib/plan-edit.test.ts`** — 13 tests for the new pure helpers: `computeQuantities` (≥1 each, pins kept while un-pinned rebalance, paved density, 200 cap), `matchingSurvivors` (sun/zone/fit), `mergeDuplicateLines` (sum + keep pinned/flag/earliest order), `isPlanStale` (unchanged vs. area/soil/maintenance changes).

### Files changed
- **`src/lib/plan-engine.ts`** — added shared pure helpers **`siteSoil`**, **`siteZone`**, **`matchingSurvivors`** (the add-list / generation filter), and **`computeQuantities`** (rebalance a fixed set honouring pinned quantities). `generatePlan` refactored to call `siteSoil`/`siteZone`/`matchingSurvivors` — **output-preserving** (all 22 PROJ-6 engine tests still green).
- **`src/lib/plans.ts`** — added `pinned` to the `PlanPlant` type; added pure helpers **`mergeDuplicateLines`** and **`isPlanStale`**.
- **`src/components/plans/generate-plan-button.tsx`** — added an optional **`confirmMessage`** prop; when set, an `AlertDialog` confirms before generating (used by Regenerate to warn it discards edits). First-time Generate (scan detail) is unchanged.
- **`src/app/scans/[id]/plan/page.tsx`** — now also fetches the catalogue + the user's `maintenance_preference`, computes `matchingSurvivors` (add list) + `isPlanStale`, merges duplicate lines, and renders `PlanEditor`.
- **Removed `src/components/plans/plan-view.tsx`** — the read-only view is superseded by the editor (no remaining references).

### Post-deploy tweaks
- **2026-06-23 — Reset button on pinned quantities.** When a quantity is hand-set the plant is pinned ("set by you"); a **Reset** control (↺) now appears next to it. Reset un-pins the line so it rejoins auto-rebalancing and returns to an engine-computed quantity for the current set. Added `resetQty` in `PlanEditor` (un-pin → `rebalance` → immediate save) and an `onReset` button in `EditablePlantCard`. `tsc` ✓, `lint` ✓.
- **2026-06-23 — Editable quantity input.** The quantity is now a typeable `Input` (shadcn) between the −/+ buttons, so large amounts don't need repeated clicks. Typing a value pins the plant (same as the stepper); committed on blur/Enter, min 1, invalid/empty reverts to the current value. Added `setQty` in `PlanEditor` and a local draft + `onSet` in `EditablePlantCard`. `tsc` ✓, `lint` ✓.
- **2026-07-02/03 — Land straight on the plan + compact conditions.** The scan wizard's review CTA ("Looks right — show me my plan") and the "Generate plan" button now navigate straight to `/scans/{code}/plan`, **skipping the scan detail page** for the create flow (editing an existing scan still returns to its detail page).
- **2026-07-03 — Plan screen is now the space's home; scan detail is edit-only.** Since the create flow lands on the plan, the plan screen now shows the space's **uploaded photo** at the top with an **Edit button overlaid top-right** that leads to the scan detail/overview page (`/scans/{code}`) — the detail page is now reached only via that button. The header's top-left nav changed from "← Space" (→ scan detail) to **"← Spaces" (→ `/scans`, My Spaces)**. Shared `PlanHeader` + `SpacePhoto` locals in `plan/page.tsx`; photo fetched via the same signed-URL pattern as the detail page. Applies to both the auto-build and built-plan branches. When the user arrives with no plan yet, the plan screen **auto-builds** it in place (new `PlanBuilder` waits ≤12 s for async enrichment via Realtime, then runs the shared `persistGeneratedPlan` helper and refreshes into the read-only `PlanEditor`) rather than bouncing back to the scan. Plan-persist logic extracted to `src/lib/plans-client.ts` (`persistGeneratedPlan`) and reused by both `PlanBuilder` and `GeneratePlanButton`. Conditions on the plan screen are now a **compact chip strip** (`PlanConditions` / `ConditionChips`, `plan-conditions.tsx`) instead of the full-size "Based on your conditions" card — shown both during auto-build (current scan conditions) and on the built plan (sourced from the plan *snapshot*, so it still reflects "what the plan was based on" and stays honest when stale). Co-located `plan-conditions.test.tsx` (+5 tests). Frontend-only, no DB change; suite 246/246 green, build + lint clean.

### Deviations / decisions during build
- **Auto-save = replace the plan's lines** (delete-all + insert current) on each change rather than per-row diffs — simplest and correct for a ≤dozen-row plan; it also writes back the merged/rebalanced set, so duplicate lines self-heal. Stepper debounced; add/remove immediate. Last-write-wins (project convention).
- **Rebalance uses the plan's snapshot** area/surface (not the live scan) so editing stays consistent with what the plan was generated against; a changed scan surfaces via the staleness banner → Regenerate.
- **`generatePlan` insert still omits `pinned`** (relies on the DB default `false`); the editor writes `pinned` explicitly.
- **Tolerates the `pinned` column not existing yet** on read (`Boolean(l.pinned)` → false); saves will error with a toast until `/backend` adds the column (staged flow).

### Backend contract for `/backend`
- **`public.plan_plants`:** add **`pinned boolean not null default false`**. RLS already covers `plan_plants` for the owner (insert/update/delete via the `plans`→`scans` join from PROJ-6) — **no new policies, no new routes**. That single column is the only backend change.

## Backend Implementation (Backend Developer)
**Date:** 2026-06-22 — `/backend` phase. **One column, no routes, no new policies.** Build unaffected (no source change this phase); unit **143/143** ✓ from `/frontend` stand.

### Files added
- **`supabase/migrations/20260622120000_proj7_plan_plants_pinned.sql`** — adds `plan_plants.pinned boolean not null default false`. The editor writes it; rebalancing skips pinned lines. Default `false` backfills the existing row(s) cleanly.

### Notes
- **No RLS/grant/route changes.** Owner-only access to `plan_plants` (joined through `plans` → `scans`) and the table grants were set in PROJ-6's migrations and already cover the new column. Plan edits go through the authenticated browser client (repo pattern) — no API route to add or integration-test. The testable backend logic is the pure engine/edit helpers (`computeQuantities`, `matchingSurvivors`, `mergeDuplicateLines`, `isPlanStale`), covered by `src/lib/plan-edit.test.ts` (13 tests) + the unchanged PROJ-6 engine tests.

### To activate (operator / `/qa` / `/deploy`)
1. Apply `20260622120000_proj7_plan_plants_pinned.sql` to the Supabase project (SQL editor / push). Until applied, the editor renders but **saving edits errors** (the staged-flow behaviour).
2. No env vars, no seeds, no Realtime.

## QA Test Results
**Date:** 2026-06-22 · **QA:** `/qa` pass 1 · **Build:** unit **146/146** ✓, E2E **78/78** ✓, `lint` ✓, `tsc` ✓

### Verdict: ✅ Production-ready (no Critical/High/Medium bugs) — 1 INFO item.

### Test assets added
- `src/lib/plan-edit.test.ts` — **13** tests for the pure editor helpers: `computeQuantities` (≥1 each, pins kept while un-pinned rebalance, paved density, 200 cap, empty set, all-pinned), `matchingSurvivors` (sun/zone/fit), `mergeDuplicateLines` (sum + keep pinned/flag/earliest, no-dup passthrough), `isPlanStale` (unchanged vs. area/soil/maintenance changes).
- `tests/PROJ-7-plan-edit-rls-isolation.spec.ts` — **8** two-account tests: owner inserts lines incl. a pinned one; `pinned`+quantity round-trip; owner updates a line (stepper/rebalance persistence); the editor's "replace all lines" save (delete-all + re-insert); and owner-only denial — B cannot read / insert / update / delete A's plan lines (incl. flipping `pinned`).

### Acceptance criteria
| Area | Criterion | Result | How verified |
|---|---|---|---|
| Editing | Plan view is editable in place | ✅ | code review (`PlanEditor`) |
| Editing | Remove → un-pinned rebalance | ✅ | `computeQuantities` unit + harness (delete) |
| Editing | Add from matching survivors → rebalance | ✅ | `matchingSurvivors` + `computeQuantities` unit; code review (add list) |
| Editing | Stepper change pins the plant + keeps value | ✅ | `computeQuantities` unit (pins kept) + harness (`pinned` round-trip) |
| Editing | Pinned excluded from rebalance; un-pinned refill | ✅ | **unit test** (pins kept, un-pinned recomputed) |
| Editing | Edits auto-save & persist | ✅ | **harness** (insert/update/delete/replace persist) |
| Editing | Add list offers only matching (suitable) plants | ✅ | `matchingSurvivors` unit + code review |
| Order seam | Disabled "Order" CTA, marked next step | ✅ | code review |
| Order seam | Empty plan → no active Order | ✅ | code review (empty state) |
| Plan rendering | Duplicate plant lines merged | ✅ | `mergeDuplicateLines` **unit test** |
| Staleness | Matching-input change → banner + Regenerate | ✅ | `isPlanStale` **unit test** + code review (banner, confirm) |
| Staleness | Cosmetic change (name/photo) → not stale | ✅ | `isPlanStale` **unit test** (only matching fields compared) |
| Staleness | Regenerate confirms, discards edits, never blocks Order | ✅ | code review (`GeneratePlanButton confirmMessage`) |
| Security | Owner-only view/edit; B can't touch A's lines | ✅ | **RLS harness** (read/insert/update/delete denied) ★ |
| Security | Unauthenticated → `/login` | ✅ | **E2E** (`PROJ-6-plan-routes`, same route, 2 browsers) |

### Edge cases
Covered by unit tests or by-design: empty plan (empty-set rebalance ✓ + empty state), all-pinned then add (all-pinned unit ✓), removing the last plant (empty state, Order disabled — code review), pinned quantities exceed area (allowed; 200 cap guards — unit), duplicate from reassignment (merge ✓), staleness + cosmetic change ignored (✓). Concurrent two-tab edits = last-write-wins (project convention).

### Security audit (red team)
- ✅ **Owner-only editing at the DB** — the harness proves user B cannot read, insert, update or delete user A's plan lines, and cannot flip A's `pinned`. The `plans`→`scans` join RLS from PROJ-6 covers the new column with no policy change.
- ✅ **The "replace all lines" save is owner-scoped** — both the delete-all and the insert are gated by RLS; B's attempt to replace A's lines is denied (harness).
- ✅ **`pinned` is a plain boolean** — no injection/escalation surface; quantity ≥1 and FK-checked plant_id are enforced at the DB (PROJ-6 constraints).
- ✅ **No secrets, no new routes** — edits go through the anon browser client; RLS is the boundary.
- ✅ **Supabase advisor** — unchanged: only the two accepted WARNs (0029 reassignment fn by design; pre-existing leaked-password). The `pinned` column added no advisory.
- ℹ️ **INFO** — as in PROJ-6, a user can write arbitrary quantities/selections to **their own** plan via the browser client. Own data only, no cross-user impact — not a vulnerability.

### Bugs found
None Critical/High/Medium.
- **INFO-1 (by-design):** auto-save replaces the plan's lines (delete-all → insert). If the insert failed after the delete (network blip), the plan could be momentarily empty until the next edit/retry. Single-user, last-write-wins, fully recoverable by editing again; surfaced via a toast. Documented in the spec's frontend deviations. Acceptable for v1; a transactional RPC could harden it later.

### Regression
Full E2E (78) + unit (146) green. **PROJ-6's 22 engine tests pass unchanged** — the `generatePlan` refactor (extracting `siteSoil`/`siteZone`/`matchingSurvivors`) is output-preserving. PROJ-2/3/4/5/6 routes, RLS isolation, reassignment, and storage isolation all unaffected. The read-only `PlanView` was replaced by `PlanEditor` (plan still renders grouped-by-layer with conditions/notes, plus editing) — no display regression; the route protection is unchanged. The harness self-cleaned (0 leftovers; 40-plant catalogue + the 1 real plan intact).

### Residual risk / notes for `/deploy`
- The **authenticated editing UI** (stepper, add/remove in the browser, the staleness banner's Regenerate, the disabled Order seam) is validated by code review + the pure-helper unit tests + the data-layer harness, **not** an authenticated browser E2E — consistent with the repo's pattern (PROJ-3/5/6). **Recommended manual smoke at deploy:** open your real plan → add a plant, step a quantity (see "set by you"), remove one, reload → confirm persistence; then change the scan and confirm the staleness banner appears.
- The `plan_plants.pinned` migration is already applied to production (verified via MCP), so the smoke can run against live data.

## Deployment

**Deployed:** 2026-06-22
**Platform:** Vercel (auto-deploy from `main` — same project as PROJ-1…6)
**Tag:** `v1.7.0-PROJ-7`

### Pre-deploy gates (all green)
- `npm run build` clean (Next 16.1.1, Turbopack); `/scans/[id]/plan` compiles as a dynamic server route
- `npm run lint` clean · `tsc --noEmit` clean
- Unit **146/146** ✓ · E2E **78/78** ✓ (incl. PROJ-6's 22 engine tests unchanged — `generatePlan` refactor is output-preserving)
- No secrets in the committed diff
- QA: **Approved** — no Critical/High/Medium bugs (1 INFO: replace-save non-atomicity, by-design)

### Database changes (already applied to production Supabase, 2026-06-22, verified via MCP)
1. `20260622120000_proj7_plan_plants_pinned.sql` — `plan_plants.pinned boolean not null default false`. Backfilled the existing plan's 5 lines to `false` cleanly. No RLS/grant/route changes (PROJ-6's owner-only policies already cover the column).

### Env vars
No changes — reuses the existing Supabase keys.

### Post-deploy verification (recommended — manual)
- [ ] Open your plan → **add** a plant, **step** a quantity (shows "set by you"), **remove** one, **reload** → edits persisted
- [ ] Change the scan's conditions (e.g. sun) → the plan shows the **staleness banner**; Regenerate confirms then rebuilds
- [ ] No browser-console or Vercel function-log errors

### Carried forward
- **PROJ-10 (In-App Notifications, P1)** — the reassignment "your plan was updated" notice (banner + My Spaces dot) was split out of PROJ-7; its spec is Planned.
- **INFO-1** (replace-save non-atomicity) — acceptable for v1; a transactional RPC could harden it later.

## Post-Deploy Enhancement — Per-plant care notes on the plan (2026-06-24)

Each plant on the plan now shows a short info blurb under its name/badges — surfacing the existing `plants.care_notes` (e.g. *"Shear back after the first flush for a second bloom. Loves dry, sunny spots."*). This was always the intended home for the field: the admin form labels it *"Short care guidance shown later in plan review."*

- **No DB / seed / type change** — `care_notes` already exists (PROJ-5 schema + admin form), is seeded with concise notes for all 40 catalogue plants (`scripts/seed-plants.mjs`), is in the `Plant` type, and was already fetched by the plan query (`plan_plants` → `plants(*)`). It simply wasn't rendered.
- **App:** `plan-editor.tsx` `EditablePlantCard` shows a "Care tips" toggle (shadcn `Collapsible` + chevron) between the badges and the quantity stepper; the `plant.care_notes` text is **collapsed by default** and expands on click — keeps cards compact. Plants without notes render nothing (graceful).
- **Verification:** `tsc --noEmit` + `npm run lint` clean. Depends on the production catalogue having `care_notes` populated (the seed includes them); the conditional render degrades to nothing for any null row.
