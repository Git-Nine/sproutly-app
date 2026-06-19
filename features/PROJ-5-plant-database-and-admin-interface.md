# PROJ-5: Plant Database & Admin Interface

## Status: Approved
**Created:** 2026-06-19
**Last Updated:** 2026-06-20

## Dependencies
- Requires: **PROJ-1 (Supabase Infrastructure Setup)** — the `role` column on `users`, the owner-only RLS conventions, and the `authenticated`/`service_role` GRANT convention this feature's new `plants` table must follow.
- Requires: **PROJ-2 (User Authentication & Profile)** — admin gating relies on the `role = 'admin'` value and the auth middleware; the `maintenance_preference` vocabulary (`low/medium/high`) the plant `maintenance_level` must mirror.
- **Consumed by: PROJ-6 (Rule-Based Plan Generation)** — the rule engine matches these plants against a scan's enriched conditions. The plant attribute vocabulary in this spec is deliberately aligned with PROJ-3's scan fields and PROJ-4's enrichment output (see Decision Log).

## User Stories
- As the **operator/admin**, I want an initial set of German-relevant plants loaded into the database without entering them by hand, so that the rule engine (PROJ-6) has data to work with from day one.
- As the **operator/admin**, I want to add, edit, and delete plants through a private admin screen, so that I can curate the catalogue over time without touching SQL.
- As the **operator/admin**, I want to search and filter the plant list (by name, maintenance level, sun tolerance), so that I can find a specific plant quickly once the catalogue grows to hundreds of entries.
- As the **operator/admin**, I want every plant to carry the exact attributes the rule engine needs (sun, soil, hardiness, size, maintenance, native), so that plans can be generated reliably and grounded in each user's real conditions.
- As the **operator/admin**, I want to be forced to choose a replacement plant before I can delete any plant, so that no plan can ever be left pointing at a missing entry.
- As an **end user whose plan contained a deleted plant**, I want an in-app notification that my plan was updated, so that the change is transparent and my trust in the plan is preserved.
- As a **non-admin logged-in user**, I want the admin area to be invisible/inaccessible to me, so that the catalogue can only ever be changed by an authorised operator.

## Out of Scope
<!-- What this feature explicitly does NOT cover. Critical for developer handoffs. -->
- **Using plant data to generate plans / matching plants to a scan** — that is **PROJ-6**. PROJ-5 only stores and curates plants; it does not query them against conditions.
- **Showing plants to end users** (plan review, shopping list thumbnails) — **PROJ-6 / PROJ-7 / PROJ-8** consume the data; PROJ-5 has no end-user-facing plant screen.
- **Live integration with FloraWeb/BfN/any plant API** — the seed is a **one-time import** of cleaned reference data, not a live sync. No scheduled refresh.
- **Image upload / Supabase Storage for plant photos** — plants carry an optional **image URL** only. No upload pipeline (contrast with PROJ-2/PROJ-3 which do upload).
- **Admin role-management UI** — admins are still promoted manually via SQL/dashboard (decided in PROJ-1). PROJ-5 only *reads* `role = 'admin'`; it never grants it.
- **Moisture / drainage / pH plant attributes** — dropped for v1: there is no corresponding site value to match against (the scan and PROJ-4 enrichment produce none). Revisit if PROJ-6 proves it needs them — mirrors PROJ-4's deferral of soil moisture.
- **Soft-delete / archive / version history of plants** — deletion is a hard delete (with reassignment, see below). No `is_active` flag, no audit trail of catalogue changes for v1.
- **The replacement-on-delete *reassignment of plan references* and the *in-app notification* to affected users** — *specified* here as the deletion contract, but only *activates* once `plan_plants` exists (PROJ-6/7). In PROJ-5 the mandatory replacement *selector* is built and enforced, but there are no plan references to reassign and no users to notify yet. See "Deletion & Replacement" and the forward note for PROJ-6/7.
- **Push notifications** — the plan-updated notice is strictly **in-app** (a notification surface in the app), not push/email; push remains a v2 non-goal per the PRD.
- **Bulk edit / bulk delete / CSV editing through the UI** — single-record add/edit/delete only for v1. Bulk loading happens via the seed script.
- **Localisation of the admin UI** — German-relevant plant *data*, but the admin screen itself is not translated for v1.

## Plant Data Model (product-level — `/architecture` owns the schema)
Each plant record holds:

**Required (the rule engine cannot match a plant without these):**
- **Common name** — text (German common name).
- **Latin name** — text, **unique** (prevents duplicate entries across seeding + curation).
- **Sun tolerance** — one or more of `full` / `partial` / `shade`. The set of light conditions the plant tolerates; PROJ-6 matches the scan's single sun value against this set.
- **Soil compatibility** — one or more of `sand` / `loam` / `clay` / `silt` / `peat`. Aligned exactly with PROJ-4's five soil buckets.
- **Min hardiness zone** — the coldest zone the plant survives (e.g. `6a`). PROJ-6 keeps the plant if the site's zone (e.g. `7b`) is at least this hardy.
- **Mature height** — for spacing/plan layout (PROJ-6).
- **Mature spread** — for plant counts/spacing against the scan's area (m²).
- **Maintenance level** — `low` / `medium` / `high`. Mirrors PROJ-2's `maintenance_preference` vocabulary so PROJ-6 can match plant ↔ user preference directly.
- **Native to Germany** — boolean, defaults to `false`. Supports the PRD's "natives beat gravel" framing for Thomas.

**Optional:**
- **Image URL** — a public URL; validated as a well-formed URL if provided. No upload.
- **Short description / care notes** — free text for plan review (PROJ-7) context.

## Deletion & Replacement
- **Mandatory replacement (always, built in PROJ-5):** an admin can **only** delete a plant by selecting a **different existing plant from the list as its replacement**. The confirmation dialog cannot be confirmed without a replacement selected. On confirm, the plant is **hard-deleted** (row permanently removed). This rule is unconditional — it applies whether or not the plant is currently used in any plan — so the catalogue can never lose a plant without a designated successor.
- **No auto-suggestion:** the admin chooses the replacement manually. There is no system "best guess" for v1.
- **Reassignment of plan references (activates when `plan_plants` exists — PROJ-6/7):** on delete, all `plan_plants` rows referencing the deleted plant are **reassigned to the chosen replacement**, *then* the plant is hard-deleted. Every affected plan then legitimately contains the replacement; **no user-facing plan ever shows a missing entry or an error**.
- **In-app notification (activates with PROJ-6/7):** each end user whose plan was changed by a reassignment receives an **in-app notification** that their plan was updated. This applies even to *accepted* plans — the change is transparent, never silent.
- In PROJ-5 in isolation there are no plan references to reassign and no users to notify; only the mandatory-replacement dialog + hard delete is reachable and testable now.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Seeding
- [ ] Given an empty `plants` table, when the seed script is run, then an initial set of German-relevant plants is loaded, each with all required attributes populated.
- [ ] Given the seed script is run a second time, when it executes, then it does not create duplicate plants (idempotent on the unique Latin name).

### Access control
- [ ] Given a logged-in user with `role = 'admin'`, when they navigate to `/admin/plants`, then the plant management screen loads.
- [ ] Given a logged-in user with `role = 'user'`, when they navigate to `/admin/plants`, then they are redirected to `/scans` (the admin area is not revealed to them).
- [ ] Given an unauthenticated visitor, when they navigate to `/admin/plants`, then they are redirected to `/login` (PROJ-2's gate).
- [ ] Given a non-admin user, when they send a crafted insert/update/delete request directly to the `plants` table, then it is rejected by RLS at the database (server-side enforcement, not just UI).

### List, search & filter
- [ ] Given seeded plants, when an admin opens `/admin/plants`, then plants are listed in a table with at least name, sun tolerance, maintenance level, and native flag visible.
- [ ] Given a populated list, when the admin types into search, then the list filters to plants whose common or Latin name matches.
- [ ] Given a populated list, when the admin filters by maintenance level and/or sun tolerance, then only matching plants are shown.
- [ ] Given no plants exist (e.g. before seeding), when an admin opens `/admin/plants`, then an empty state invites them to add the first plant.

### Add / edit
- [ ] Given an admin on the add-plant form, when they submit with all required fields valid, then the plant is created and appears in the list.
- [ ] Given an admin on the add/edit form, when any required field is missing or invalid, then a validation error names each offending field and nothing is saved.
- [ ] Given an admin enters a Latin name that already exists, when they submit, then a clear "this plant already exists" error is shown and no duplicate is created.
- [ ] Given an admin provides an image URL, when it is not a well-formed URL, then a validation error is shown; when it is empty, then the plant saves without an image.
- [ ] Given an existing plant, when an admin edits its fields and saves, then the changes persist and are reflected in the list.

### Delete (PROJ-5 scope)
- [ ] Given an existing plant, when an admin clicks Delete, then a confirmation dialog appears requiring a replacement plant to be selected before anything is removed.
- [ ] Given the delete dialog with no replacement selected, when the admin tries to confirm, then deletion is blocked and the replacement selection is requested.
- [ ] Given the delete dialog, when the admin selects a different plant as replacement and confirms, then the plant is hard-deleted and removed from the list; when they cancel, then nothing changes.
- [ ] Given only one plant exists in the catalogue, when an admin tries to delete it, then deletion is not possible because no replacement can be selected.

### Delete reassignment & notification (forward contract — activates with PROJ-6/7, not testable in PROJ-5 alone)
- [ ] Given a plant referenced by one or more plans, when an admin deletes it with a chosen replacement, then all referencing plan entries are reassigned to the replacement and the original plant is hard-deleted, with no plan left referencing a missing plant.
- [ ] Given a user's plan (including an accepted plan) had a plant reassigned, when the reassignment completes, then that user receives an in-app notification that their plan was updated.

## Edge Cases
- **Duplicate Latin name on add or edit** → rejected by the unique constraint; the form shows a friendly "already exists" message rather than a raw database error.
- **Image URL points at a dead/unreachable image** → PROJ-5 only validates URL *format*, not reachability; PROJ-6/7/8 render with a graceful fallback (broken-image handling is the consumer's concern, noted for them).
- **Admin deletes the *last* plant in the catalogue** → **not possible**: deletion requires selecting a different plant as replacement, and none exists. The catalogue can shrink to one plant but not to zero via the UI.
- **Admin selects the plant being deleted as its own replacement** → blocked: the replacement must be a *different* plant.
- **Two admins edit the same plant concurrently** → last write wins for v1 (single-operator assumption); no optimistic-locking UI. Noted as acceptable given one operator.
- **Seed script run against a partially-populated table** → must not clobber admin edits to existing plants nor create duplicates (idempotent insert on Latin name; does not overwrite).
- **Required attribute genuinely unknown for a seeded plant** (BfN data gap) → the seed must still satisfy required fields; the curator fills/fixes via the admin UI. The data model has no "unknown" sentinel for required fields.

## Technical Requirements (optional)
- **Security:** `plants` table — all `authenticated` users may **read**; only `role = 'admin'` may **insert/update/delete**, enforced by RLS at the database (per PRD constraint). Explicit `GRANT ... TO authenticated` per PROJ-2's BUG-7 convention. Admin route redirect is UX only; the DB is the real boundary.
- **Performance:** the list/search/filter must stay responsive at a few hundred plants (the expected v1 catalogue size).
- **Data alignment:** plant attribute vocabularies must remain in lockstep with PROJ-3 (sun) and PROJ-4 (soil, hardiness zone) — any change to those buckets is a breaking change for PROJ-6 matching.

## Open Questions
<!-- Unresolved questions from the spec interview. Close them in /refine when answered. -->
- [ ] **In-app notification surface** — no in-app notification mechanism exists yet. Where do plan-updated notices live (a bell/inbox, a banner on the plan, a badge on "My Plans")? Owned by PROJ-7 (plan review/acceptance); confirm there.
- [ ] **Reassignment of *accepted* plans** — resolved in principle (the plan changes and the user is notified, never silent), but the exact UX of surfacing the change on an accepted plan is a PROJ-7 detail.
- [ ] **Seed source & licensing** — confirm the exact FloraWeb/BfN dataset, its licence for redistribution, and the cleaning steps before import.
- [x] **Hardiness zone storage** — RESOLVED at `/architecture`: store as a whole-number integer (e.g. `6`) to match PROJ-4's whole-number zone output; PROJ-6 matches with a plain `site_zone >= plant.min_zone`. The `a`/`b` subzone is dropped for v1. See Technical Decisions.

## Decision Log
<!-- Record of conscious decisions made and why. Added to by /write-spec and /architecture. -->

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| Seed script + admin UI for curation (not manual-only, not live API) | BfN/FloraWeb is reference data, not a live API; one-time clean import gives PROJ-6 data immediately; admin UI handles ongoing curation | 2026-06-19 |
| Plant attribute vocabulary aligned to scan (sun) + enrichment (soil, zone) + profile (maintenance) | The rule engine (PROJ-6) can only match if plant and site share vocabularies; alignment is the whole point of the data model | 2026-06-19 |
| Added `maintenance_level` (low/medium/high) | Directly maps to Maya's and Thomas's decision criteria and to PROJ-2's `maintenance_preference`; lets PROJ-6 personalise | 2026-06-19 |
| Dropped `moisture` for v1 | No site moisture value is captured (scan or enrichment) to match against; would be an orphan attribute. Same reasoning as PROJ-4 deferring soil moisture | 2026-06-19 |
| Latin name is unique | Prevents duplicate plant entries across seeding and admin curation; gives the seed an idempotency key | 2026-06-19 |
| Optional image URL field (no upload) | Seed photos come as public URLs; keeps PROJ-5 free of a storage/upload pipeline; thumbnails still available to PROJ-6/7/8 | 2026-06-19 |
| Sun tolerance & soil compatibility are multi-value sets | A plant tolerates a *range* of conditions; matching = site's single value ∈ plant's set | 2026-06-19 |
| Required vs optional split (matching fields required; image/notes optional) | PROJ-6 cannot match without the matching fields; cosmetic fields shouldn't block creating a usable plant | 2026-06-19 |
| Non-admins redirected to `/scans` (not a 403 page) | Don't reveal the admin route exists; RLS is the real security boundary, the redirect is UX | 2026-06-19 |
| Hard delete, with a **mandatory** replacement (admin must pick a different existing plant to delete any plant) | Guarantees the catalogue never loses a plant without a successor; keeps PROJ-5 simple (no soft-delete filtering tax); reassignment means no user ever sees a missing plant | 2026-06-19 |
| Admin picks the replacement manually — no auto-suggestion for v1 | Simpler and gives the operator full control; a rule-engine "best guess" can be added later (reuses PROJ-6 matching) | 2026-06-19 |
| Affected users get an **in-app** notification when a reassignment changes their plan (incl. accepted plans) | Transparency preserves trust — a plan must never change silently; in-app (not push, which is a v2 non-goal) | 2026-06-19 |
| Reassignment + notification specified here but activated in PROJ-6/7 | No `plan_plants` table or notification surface exists yet; the mandatory-replacement selector is built now, the rest activates when plans exist. Capturing the contract prevents an undocumented landmine | 2026-06-19 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| New `plants` table in Supabase (not localStorage / not a static file) | The catalogue is shared org-wide, admin-curated, and queried by PROJ-6's rule engine. Must live server-side with RLS, exactly like `scans`/`users`. | 2026-06-20 |
| Multi-value attributes (sun tolerance, soil compatibility) stored as text **arrays** with per-element value checks — not a join table | A few hundred admin-only rows; the only query is "does the site's single value belong to the plant's set." An array answers that directly and keeps the admin form a single record. A join table adds tables/joins for no v1 benefit. | 2026-06-20 |
| Hardiness zone stored as a **whole-number integer** (e.g. `6`), comparison is `site_zone >= plant.min_zone` | PROJ-4 enrichment already emits whole-number zones (e.g. `'7'`); aligning the plant field to the same scale makes PROJ-6 matching a plain numeric `>=`. The `a`/`b` subzone in the original product copy is dropped for v1 to stay in lockstep with PROJ-4 (resolves Open Question #4). | 2026-06-20 |
| RLS: all `authenticated` read; only admins write, via a `public.is_admin()` **SECURITY INVOKER** helper | Mirrors the PRD constraint and PROJ-1's role model. A shared helper keeps the three write policies readable and avoids repeating the `users` sub-select. INVOKER (not DEFINER) is correct because the check only reads the caller's *own* `users` row, which PROJ-1's "view own profile" policy already permits — and INVOKER sidesteps the SECURITY DEFINER advisor warning (0028/0029). `search_path` pinned to `''`. Explicit `GRANT`s per PROJ-2's BUG-7 / PROJ-3's grant convention. | 2026-06-20 |
| Admin route gated **server-side** in the page (read `role`, redirect non-admins to `/scans`); middleware unchanged | The existing middleware only does auth (logged-in?) gating and explicitly skips role logic. Adding a DB role read to middleware would tax every request; a server-component check on the admin route is cheaper and co-located. The redirect is UX only — RLS is the real boundary. | 2026-06-20 |
| Add/edit as dedicated routes (`/admin/plants/new`, `/admin/plants/[id]/edit`); delete as an in-list dialog | Mirrors the existing `scans/new` + `scans/[id]/edit` pattern; ~10 fields incl. multi-selects need more room than a 390px dialog gives. Delete is a quick confirm, so it stays inline as an `AlertDialog`. | 2026-06-20 |
| Writes via the **authenticated browser Supabase client** from client components (matches `scan-form`/`profile-form`), validated by the shared Zod schema; RLS enforces admin-only at the DB | Consistency with the established repo write pattern over introducing Server Actions for one feature; the `plants` RLS admin policy is the real trust boundary regardless of where the call originates. | 2026-06-20 |
| Search & filter are **client-side** over a single full fetch of the list | A few hundred rows is trivial to hold in memory; instant filtering with no round-trips. Revisit only if the catalogue grows past low thousands. | 2026-06-20 |
| Duplicate Latin name surfaced by **catching the unique-constraint violation**, not a pre-check `select` | One round-trip, race-free; the DB unique index is the source of truth. The action maps the constraint error to a friendly "this plant already exists" field error. | 2026-06-20 |
| Seeding via an **idempotent Node script** (`npm run seed:plants`) using the service-role client — not a SQL migration | Seed data is data, not schema; it must be re-runnable and must not clobber admin edits. `upsert ... onConflict: latin_name` (insert-or-ignore semantics) gives idempotency without overwriting curated rows. Keeping it out of migrations avoids re-seeding on every `db push`. | 2026-06-20 |
| Delete server action takes `(plantId, replacementId)`; validates replacement exists and ≠ target; in PROJ-5 it performs the hard delete only | The mandatory-replacement contract is enforced now; the reassignment of `plan_plants` + user notification is a no-op until those tables exist (PROJ-6/7). Building the signature now means PROJ-6/7 only add the reassignment step, not re-plumb the call. | 2026-06-20 |
| Shared plant vocabulary + Zod schema in `src/lib/plants.ts` (mirrors `src/lib/scans.ts`) | One source of truth for option sets, labels, and validation, imported by the form, the table, the seed script, and later PROJ-6. Keeps plant ↔ scan ↔ enrichment vocabularies aligned in one place. | 2026-06-20 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Overview
PROJ-5 adds one server-side **`plants`** table and a private **`/admin/plants`** area to manage it. Regular users can read the catalogue (PROJ-6 will need that); only admins can change it. Nothing here is shown to end users — it exists so the rule engine has clean, rule-tagged data to plan from. There is no new external integration: an initial catalogue is loaded once by a seed script, and the admin curates it from then on.

### Component Structure (what gets built)
```
/admin/plants  (admin-only page — server-checks role, else redirects)
├── Admin header (title, "Add plant" button)
├── PlantsManager  (client — holds the in-memory list + filter state)
│   ├── Toolbar
│   │   ├── Search box        (matches common OR Latin name)
│   │   ├── Maintenance filter (low / medium / high — shadcn Select)
│   │   └── Sun filter         (full / partial / shade — shadcn Select)
│   ├── PlantsTable           (shadcn Table)
│   │   └── per row: name · Latin · sun badges · maintenance · native ✓ · Edit / Delete
│   ├── EmptyState            ("Add your first plant" — when catalogue is empty)
│   └── DeletePlantDialog     (shadcn AlertDialog)
│       └── Replacement picker (searchable list of OTHER plants — confirm disabled until one is chosen)
│
├── /admin/plants/new          (the add form — dedicated route)
└── /admin/plants/[id]/edit    (the edit form — same form, prefilled)
        └── PlantForm (client — shared Zod-validated form for add + edit)
```
All UI is composed from already-installed shadcn components (Table, Select, AlertDialog, Dialog, Command, Badge, Form, Input, Checkbox/Switch) — nothing custom is recreated.

### Data Model (plain language)
A new **`plants`** table. Each plant holds:

**Required (rule engine cannot match without these):**
- **Common name** — German common name (text).
- **Latin name** — text, **unique** (blocks duplicates; the seed script's idempotency key).
- **Sun tolerance** — a *set* of `full` / `partial` / `shade` (the conditions it tolerates).
- **Soil compatibility** — a *set* of `sand` / `loam` / `clay` / `silt` / `peat` (PROJ-4's five soil buckets).
- **Min hardiness zone** — a whole number (e.g. `6`). The coldest zone it survives; PROJ-6 keeps it when `site_zone >= this`.
- **Mature height** & **Mature spread** — for spacing/plant-count maths in PROJ-6.
- **Maintenance level** — `low` / `medium` / `high` (mirrors the profile's `maintenance_preference`).
- **Native to Germany** — yes/no, defaults to no.

**Optional:**
- **Image URL** — a public URL, format-validated only (no upload, no reachability check).
- **Care notes** — free text for later plan-review context.

Plus housekeeping: a unique ID, created/updated timestamps.

**Stored in:** Supabase Postgres. **Access:** every signed-in user can *read*; only admins can *add/edit/delete*, enforced by Row Level Security at the database (an `is_admin()` check), with the admin route redirect as a UX courtesy on top.

### How the pieces talk
- **Seeding:** a one-time `npm run seed:plants` script loads cleaned German-relevant plants using the service-role key. Re-running it never duplicates and never overwrites admin edits (insert-or-ignore on the Latin name).
- **Listing:** the page fetches the full list once; search and the two filters run instantly in the browser.
- **Add / edit:** the form validates against a shared rule set, then a server action writes through the admin-gated table. A duplicate Latin name comes back as a friendly "already exists" error rather than a raw DB error.
- **Delete:** the admin must pick a *different* existing plant as a replacement before the confirm button enables. On confirm, PROJ-5 hard-deletes the plant. The replacement is carried through the call so that **PROJ-6/7 only need to add** the step that re-points existing plan entries to the replacement and notifies affected users — the contract is wired now, dormant until plans exist.

### Tech Decisions (why, in brief)
- **A real table, not local storage** — the catalogue is shared and queried by the rule engine; it belongs in Postgres with RLS like every other data table here.
- **Arrays for the multi-value attributes** — a plant tolerates a *range* of sun/soil; an array stores that and answers "is the site's value in the set?" without extra tables.
- **Whole-number hardiness zone** — matches the number PROJ-4 already produces, so matching is a simple "is the site at least this hardy?".
- **Admin check in two places** — the database (the real lock) and a friendly redirect on the page (so the admin URL isn't even revealed to regular users).
- **Seed as a re-runnable script, not a migration** — seed content is data that may be re-imported and must not clobber curated rows; migrations are for schema only.

### Dependencies (packages to install)
**None.** Everything needed is already present: Supabase client/admin, Zod + react-hook-form, and all required shadcn components (Table, Select, AlertDialog, Command, Badge, Form). The only new repo addition is a `seed:plants` script entry in `package.json`.

### Forward note for PROJ-6 / PROJ-7
- PROJ-6 reads `plants` and matches on: `site.sun ∈ sun_tolerance`, `site.soil ∈ soil_compatibility`, `site_zone >= min_hardiness_zone`, plus maintenance/native preferences.
- The delete flow's reassignment of `plan_plants` and the in-app "your plan was updated" notification activate when those tables/surfaces exist — the delete action already accepts the replacement to make that a pure addition.

## Frontend Implementation (Frontend Developer)
**Date:** 2026-06-20 — `/frontend` phase. UI complete; **awaits `/backend`** for the `plants` table, RLS, GRANTs, and seed script (reads/writes error until then — same staged flow as PROJ-2/3).

### Files added
- **`src/lib/plants.ts`** — shared contract: `Plant` type, `plantSchema` (Zod), option sets (`SUN_OPTIONS` reused from scans, `SOIL_OPTIONS`, `MAINTENANCE_OPTIONS` reused from profile, `ZONE_OPTIONS`), labels/helpers, `PLANTS_TABLE`. Single source of truth for the form, table, and (later) the seed script + PROJ-6.
- **`src/lib/admin.ts`** — `requireAdmin(returnTo)` server gate: redirects unauthenticated → `/login`, non-admins → `/scans` (route not revealed). RLS is the real boundary.
- **`src/app/admin/plants/page.tsx`** — admin-gated list page; fetches plants (tolerates table-missing), renders `PlantsManager`.
- **`src/app/admin/plants/new/page.tsx`** & **`src/app/admin/plants/[id]/edit/page.tsx`** — add/edit routes (mirror `scans/new` + `scans/[id]/edit`).
- **`src/components/admin/plants-manager.tsx`** — client list: search (name), maintenance + sun filters (all client-side), shadcn `Table`, empty state vs "no matches", delete trigger (disabled when only one plant remains).
- **`src/components/admin/plant-form.tsx`** — client add/edit form; multi-value sun/soil via `Checkbox` groups, `Select` for zone/maintenance, `Switch` for native, `Textarea` for notes. Validates with `plantSchema`; writes via the authenticated browser client; maps unique-violation `23505` → friendly "Latin name already exists" field error.
- **`src/components/admin/delete-plant-dialog.tsx`** — mandatory-replacement delete: searchable `Command` combobox of *other* plants; confirm disabled until a replacement is chosen. PROJ-5 performs the hard delete only.
- **`src/app/page.tsx`** — added a discreet admin-only "Plants" header link (regular users never see it).

### Deviations / decisions during build
- **Client-side writes, not Server Actions** — switched to match the established `scan-form`/`profile-form` pattern; RLS is the trust boundary either way. Decision Log updated.
- **Mature size stored in cm** (`mature_height_cm`, `mature_spread_cm`, integers 1–3000) — units weren't fixed in the spec; cm chosen for clean integer matching in PROJ-6.
- **Hardiness zone as a whole-number `Select` (1–12)** — implements the architecture decision; aligns with PROJ-4's whole-number zone output.
- **Delete uses `Dialog` (not `AlertDialog`)** — it hosts an interactive searchable picker, which `Dialog` accommodates better than a plain confirm `AlertDialog`.

### Backend contract for `/backend` (table shape the UI expects)
`public.plants`: `id uuid pk`, `common_name text`, `latin_name text **unique**`, `sun_tolerance text[]` (∈ full/partial/shade), `soil_compatibility text[]` (∈ sand/loam/clay/silt/peat), `min_hardiness_zone smallint`, `mature_height_cm int`, `mature_spread_cm int`, `maintenance_level text` (low/medium/high), `native boolean default false`, `image_url text null`, `care_notes text null`, `created_at`, `updated_at`. RLS: `authenticated` read-all; `insert/update/delete` admin-only (`is_admin()`); explicit GRANTs (PROJ-2 BUG-7 convention). Plus the idempotent `npm run seed:plants` script.

## Backend Implementation (Backend Developer)
**Date:** 2026-06-20 — `/backend` phase. Schema + RLS + seed complete. **Migrations must be applied** to the Supabase project before reads/writes work (staged flow; same as PROJ-3/4).

### Files added
- **`supabase/migrations/20260620100000_proj5_plants.sql`** — `public.plants` table with all required columns + CHECK constraints (multi-value `sun_tolerance`/`soil_compatibility` as `text[]` validated via the `<@` subset operator + non-empty; `latin_name` UNIQUE; whole-number `min_hardiness_zone` 1–12; sizes in cm 1–3000). RLS enabled; `public.is_admin()` SECURITY INVOKER helper; SELECT for all `authenticated`, INSERT/UPDATE/DELETE admin-only; `idx_plants_common_name` for the list ordering; `updated_at` trigger reusing PROJ-3's `set_updated_at()`.
- **`supabase/migrations/20260620100100_proj5_grant_plants_privileges.sql`** — base `GRANT`s for `authenticated` + `service_role` (the PROJ-2 BUG-7 / PROJ-3 / PROJ-4 convention; RLS narrows from there).
- **`scripts/seed-plants.mjs`** + **`npm run seed:plants`** — idempotent service-role seed of 14 German-relevant plants (`upsert … onConflict: latin_name, ignoreDuplicates` → ON CONFLICT DO NOTHING; never duplicates, never clobbers admin edits). Run with `node --env-file=.env.local`.
- **`scripts/seed-plants.test.ts`** — validates every seed row against the shared `plantSchema`, asserts no duplicate Latin names, and checks native + shade coverage (4 tests, green). `vitest.config.ts` `include` extended to cover `scripts/`.

### Notes / deviations
- **No API routes.** Writes go through the authenticated browser Supabase client (the repo's established pattern), gated by the `plants` RLS admin policies; reads are server-component queries. So there are no route handlers to integration-test — the seed-data test is the testable backend unit.
- **`is_admin()` is SECURITY INVOKER, not DEFINER** (corrected from the original architecture note) — it only reads the caller's own `users` row, which their existing RLS permits, and INVOKER avoids the SECURITY DEFINER advisor (0028/0029). See Decision Log.
- **Frontend already wired** to `PLANTS_TABLE` — no mock data to replace.

### To activate (operator / `/deploy`)
1. Apply the two migrations to the Supabase project (push migrations or run in the SQL editor).
2. Promote an account to admin: `update public.users set role = 'admin' where id = '<uuid>';` (manual, per PROJ-1).
3. `npm run seed:plants` to load the initial catalogue.

## QA Test Results
**Date:** 2026-06-20 · **QA:** `/qa` pass 1 · **Build:** unit 106/106 ✓, E2E 58/58 ✓, lint ✓, `tsc` ✓

### Verdict: ✅ Production-ready (no Critical/High bugs) — 2 Low findings, both forward-looking for PROJ-6/7/8.

### Test assets added
- `src/lib/plants.test.ts` — 22 tests: `plantSchema` validation contract (required fields, enums, numeric bounds, image-URL, notes length) + helpers.
- `src/components/admin/plants-manager.test.tsx` — 6 tests: list rendering, name search (common + Latin), empty state, no-match, delete-disabled-when-single.
- `tests/PROJ-5-admin-routes.spec.ts` — 3 browser tests: unauthenticated redirect→`/login` for all three admin routes.
- `tests/PROJ-5-plants-rls-isolation.spec.ts` — 10 two-account tests (admin + non-admin): the security ACs.
- `scripts/seed-plants.test.ts` — 4 tests (from `/backend`): seed-data validity, no duplicate Latin names, coverage.

### Acceptance criteria
| Area | Criterion | Result | How verified |
|---|---|---|---|
| Seeding | Seed loads German plants with all required attrs | ✅ | manual seed run (14 inserted) + seed-data schema test |
| Seeding | Idempotent on re-run (no duplicates) | ✅ | RLS harness idempotency test + no-dup-Latin test |
| Access | Admin → `/admin/plants` loads | ✅ | code review (`requireAdmin` returns for admin) + manual |
| Access | Non-admin → redirected to `/scans` | ✅ | code review (`requireAdmin` redirect) |
| Access | Unauthenticated → redirected to `/login` | ✅ | **E2E** (3 routes, 2 browsers) |
| Access | **Non-admin direct insert/update/delete rejected by RLS** | ✅ | **RLS harness** — insert errors; update/delete affect 0 rows ★ |
| List | Table shows name, sun, maintenance, native | ✅ | **component test** |
| List | Search filters by common or Latin name | ✅ | **component test** |
| List | Filter by maintenance and/or sun | ✅ | code review (same `useMemo` pipeline the search test exercises) + manual |
| List | Empty state invites first plant | ✅ | **component test** |
| Add/Edit | Valid submit creates & appears in list | ✅ | `plantSchema` tests + code review (insert + navigate) |
| Add/Edit | Missing/invalid field → named error, nothing saved | ✅ | `plantSchema` field-error tests |
| Add/Edit | Duplicate Latin name → friendly error, no dup | ✅ | RLS harness (23505 rejected) + code review (form maps 23505) |
| Add/Edit | Bad image URL → error; empty → saves | ✅ | `plantSchema` tests |
| Add/Edit | Edit persists & reflects in list | ✅ | code review + RLS harness (admin update) |
| Delete | Confirm dialog requires a replacement | ✅ | code review (confirm disabled until chosen) |
| Delete | No replacement → deletion blocked | ✅ | code review |
| Delete | Replacement + confirm → hard delete; cancel → no-op | ✅ | RLS harness (admin delete) + code review |
| Delete | Only one plant → cannot delete | ✅ | **component test** (delete disabled when single) ★ |
| Delete (fwd) | Reassignment + in-app notification | ⏸️ N/A | forward contract — no `plan_plants`/notification surface yet (PROJ-6/7) |

### Edge cases
All documented edge cases pass or are by-design: duplicate Latin (friendly msg ✓), last-plant-undeletable (✓ component test), self-replacement blocked (dialog excludes the target ✓ code review), concurrent edit last-write-wins (by design), seed against partial table doesn't clobber edits (✓ RLS harness), seed satisfies required fields (✓ seed test). Image-URL reachability is intentionally not validated (consumer concern, per spec).

### Security audit (red team)
- ✅ **Authorization is enforced at the DB, not just the UI** — the RLS harness proves a non-admin's direct insert/update/delete is rejected regardless of the route redirect. This is the real boundary.
- ✅ **No secret exposure** — service-role key appears only in server/Node code (`scripts/seed-plants.mjs`, `lib/supabase/admin.ts`); admin client components use the anon browser client. Grep-confirmed.
- ✅ **No HTML-injection sink** — no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; all plant text is React-escaped. `image_url` is not rendered anywhere in PROJ-5.
- ✅ **No mass assignment** — insert/update send a whitelisted `fields` object built from parsed Zod data, not a spread of raw input.
- ✅ **Role-escalation guard intact** — PROJ-2's self-escalation trigger still blocks a logged-in user promoting themselves (regression test green); admin promotion only works from the privileged service-role context.
- ✅ **Route protection** — unauthenticated access to every admin route redirects to `/login` (E2E).

### Bugs found (both Low — non-blocking) → **assigned to PROJ-6** (carried in `INDEX.md` Build Order notes, 2026-06-20)
- **BUG-1 (Low) — `image_url` has no DB-level format constraint.** Only the client `plantSchema` validates format; the `plants.image_url` column is unconstrained `text`. Admin-only writes + not rendered in PROJ-5, so impact is nil now. *Fix in PROJ-6:* a `check (image_url ~ '^https?://')` or app-layer guard before the image is rendered.
- **BUG-2 (Low) — `plantSchema` URL check accepts non-http(s) schemes.** `z.string().url()` passes `javascript:`/`data:` URLs (documented by a test). Harmless in PROJ-5 (never rendered). *Fix in PROJ-6:* restrict validation to http(s) and render `image_url` only via a safe `<img src>` with an http(s) allowlist.

### Regression
Full E2E (58) + unit (106) suites green. PROJ-2/3/4 routes, RLS isolation, and storage isolation all unaffected; no shared-component visual changes (only an additive admin link on the home header, gated by role).

### Notes for the next pass / `/deploy`
- Authenticated admin **UI** flows (the full add/edit submit, the delete-dialog combobox selection) are validated by code review + the underlying RLS/validation tests, not by an authenticated browser E2E — consistent with the repo's pattern (PROJ-3 deferred its authenticated UI the same way). A manual smoke test of the live admin screen is recommended at deploy.
- BUG-1/BUG-2 are best handled in PROJ-6/7/8 (where `image_url` is first rendered), not as PROJ-5 blockers.

## Deployment

**Deployed:** 2026-06-20
**Platform:** Vercel (auto-deploy from `main` branch — same project as PROJ-1/2/3/4)
**Commit:** `429cdf6` (pushed to `main` 2026-06-20)
**Tag:** `v1.5.0-PROJ-5`

### Pre-deploy gates (all green)
- `npm run build` clean (Turbopack, Next 16.1.1); `/admin/plants`, `/admin/plants/new`, `/admin/plants/[id]/edit` compile as dynamic server routes
- `npm run lint` clean · `tsc --noEmit` clean
- Unit 106/106 ✓ · E2E 58/58 ✓ (no regressions in PROJ-2/3/4)
- No secrets in the staged diff (service-role key only referenced via `process.env`, never a literal)

### Database changes applied to production Supabase (by operator, before deploy)
1. `20260620100000_proj5_plants.sql` — `public.plants` table, RLS policies, `public.is_admin()` helper, `idx_plants_common_name`, `updated_at` trigger
2. `20260620100100_proj5_grant_plants_privileges.sql` — table-level GRANTs for `authenticated` + `service_role`
3. Admin promotion: `update public.users set role = 'admin' where email = 'hi@janine-prange.de';` (privileged context, per PROJ-1)
4. `npm run seed:plants` — initial catalogue (14 plants) loaded

No new environment variables (reuses the existing Supabase URL/anon/service-role keys). No Realtime publication needed (admin UI refreshes via `router.refresh()`).

### Env vars
No changes — `.env.local.example` already documents `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from prior features.

### Post-deploy verification (recommended — manual)
- [ ] Sign in as the admin account → home shows the "Plants" header link → `/admin/plants` loads with the 14 seeded plants
- [ ] Search + maintenance/sun filters narrow the list; add a plant; edit it; delete one (mandatory-replacement dialog)
- [ ] Sign in as a non-admin → `/admin/plants` redirects to `/scans`; no "Plants" link visible
- [ ] No browser-console or Vercel function-log errors

### Carried forward
- **BUG-1 / BUG-2** (`image_url` validation, both Low) → **PROJ-6** (see `INDEX.md` Build Order notes + QA Test Results).
