# PROJ-4: Environmental Data Enrichment

## Status: Planned
**Created:** 2026-06-18
**Last Updated:** 2026-06-18

## Dependencies
- Requires: **PROJ-3 (Photo Upload & Space Scan)** — enrichment augments a *saved* scan. It reads the scan's `postcode` (always present) and optional `lat`/`lng` (from photo EXIF GPS), and writes the derived environmental data back against that scan.
- Requires: **PROJ-1 (Supabase Infrastructure Setup)** — enriched data is stored per-scan and inherits the owner-only RLS pattern (`user_id = auth.uid()`), reached only through the scan it belongs to.
- Requires: **PROJ-2 (User Authentication & Profile)** — the whole flow lives behind the auth gate; enrichment runs only for a logged-in user's own scans.
- Reuses: the **Nominatim reverse/forward-geocode seam** introduced in PROJ-3 (`/api/geocode`) to turn a postcode into a coordinate when the photo has no GPS.

> **Note for `/architecture`:** PROJ-4 adds environmental data to a scan (new column(s) on `scans`, or a related `scan_enrichment` table — architecture's call) and the server-side integrations to three free German open-data sources (BGR soil, DWD climate, hardiness zone). The **BGR soil endpoint is a known blocking unknown** (see Open Questions) — design the soil source behind a swappable seam so a flaky/absent BGR doesn't sink the feature.

## User Stories
- As **Maya (the Guilty Non-Starter)**, I want the app to figure out my soil, climate and hardiness zone for me automatically after I scan a space, so that I don't have to know or research anything technical before getting a plan.
- As **Thomas (the Pragmatic Rockery Defender)**, I want to see the concrete conditions the plan is based on (my soil type, rainfall, hardiness zone), so that I trust the recommendations are grounded in evidence about *my* spot, not generic advice.
- As a **logged-in user who just saved a scan**, I want enrichment to happen in the background without making me wait, so that saving a space stays fast and the under-5-minute journey holds.
- As a **user whose photo had no GPS**, I want my space still enriched from my postcode, so that I get the same quality of plan as someone with a GPS-tagged photo.
- As a **user who corrected a scan's location**, I want the conditions to update to match, so that the data and any later plan reflect where the space actually is.
- As a **user in an area where a data source is temporarily unavailable**, I want the scan to still enrich with whatever *is* available and still let me proceed to a plan, so that one flaky service doesn't dead-end me.

## Out of Scope
- **Plan generation / using the enriched data to pick plants** — **PROJ-6**. PROJ-4 only *produces and displays* the conditions; the rule engine that consumes them is a separate feature.
- **Plant database** — **PROJ-5**. Enrichment characterises the *site*, not the plants.
- **Live / forecast weather, seasonal nudges, watering reminders** — out of scope (and a v2 push-notification non-goal). PROJ-4 captures long-term **climate characterisation** (normals), not today's weather.
- **AI/vision-derived environmental data** (e.g. inferring sun/shade or surface from the photo) — deferred AI swap-in point; PROJ-3 already owns the manual fields and the vision seam.
- **Non-Germany locations** — all three sources are Germany-scoped for v1, consistent with the Germany-first constraint. A non-DE location yields no enrichment.
- **Soil moisture/drainage, sun-hours modelling, seasonal temperature curves, soil pH as a hard requirement** — considered and deferred; revisit if PROJ-6 proves it needs them. (A coarse pH *band* is allowed as best-effort if BGR returns it cheaply, but is not required.)
- **User-editable / manual override of the enriched values** — v1 trusts the data sources; the user can change *location* (which re-enriches) but not hand-edit soil/zone/climate. Manual override deferred.
- **Time-based refresh / re-enrichment on a schedule** — the data is static per location; re-enrichment is triggered only by a location change (see Decisions).
- **Provenance/source-attribution UI** (showing which dataset each value came from) — deferred; the compact summary shows values only.
- **Caching strategy / shared reference data across users** — an architecture concern (same postcode → same soil/zone/climate), flagged in Open Questions, not a product requirement here.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Triggering enrichment
- [ ] Given a logged-in user saves a new scan, when the save succeeds, then environmental enrichment starts automatically in the background and the save/redirect is **not** blocked by it.
- [ ] Given a scan whose enrichment has not finished, when the user views the scan detail, then a "Gathering conditions…" pending state is shown in place of the conditions summary.
- [ ] Given enrichment completes, when the user is on (or returns to) the scan detail, then the compact "Your conditions" summary (soil, hardiness zone, climate) is shown with the available values.

### Location basis
- [ ] Given a scan whose photo had GPS (`lat`/`lng` present), when enrichment runs, then the precise coordinates are used for the lookups.
- [ ] Given a scan with no GPS, when enrichment runs, then the German postcode is forward-geocoded to a centroid coordinate and that is used, so the scan is still enriched.
- [ ] Given a location that resolves outside Germany, when enrichment runs, then no enrichment data is produced and the summary communicates that conditions aren't available for this location (consistent with Germany-first scope).

### Partial results & failure
- [ ] Given the three sources are queried independently, when one or more fails or times out, then the values that succeeded are still saved and shown, and each failed value shows an "unavailable" state.
- [ ] Given one or more sources failed, when the user views the conditions summary, then a "Retry" affordance is offered to re-attempt the missing values without re-running the ones that succeeded.
- [ ] Given enrichment is partial or fully failed, when the user proceeds toward "Generate plan" (PROJ-6), then they are **not** blocked by the missing data (PROJ-6 decides how to handle gaps).

### Re-enrichment
- [ ] Given a scan that is already enriched, when the user edits it **without** changing its location, then enrichment is **not** re-run and the existing conditions are kept.
- [ ] Given an enriched scan, when the user changes its postcode or replaces the photo with a differently-located one, then the stale conditions are invalidated and enrichment re-runs for the new location.

### Data captured
- [ ] Given a successful soil lookup, when enrichment completes, then a structured soil type (one of sand/loam/clay/silt/peat) is stored against the scan.
- [ ] Given a successful climate lookup, when enrichment completes, then average annual rainfall (mm), a typical annual minimum temperature (°C), and a frost window are stored against the scan.
- [ ] Given a successful hardiness lookup, when enrichment completes, then a hardiness zone label (e.g. "7b") is stored against the scan.

### Security & ownership
- [ ] Given two users, when A is logged in, then A can only ever see and trigger enrichment for A's own scans, never B's (owner-only RLS, reached through the scan).
- [ ] Given an unauthenticated visitor, when they attempt to view a scan's conditions or call an enrichment endpoint, then they are denied / redirected to `/login` (per PROJ-2's gate).

## Edge Cases
- **BGR soil endpoint unavailable or not yet wired** (the known blocking unknown) → soil shows "unavailable"; climate + zone still populate; plan generation (PROJ-6) is not blocked. The soil source sits behind a swappable seam.
- **No GPS *and* postcode geocoding fails/times out** → no coordinate to query; enrichment can't run; the summary shows an unavailable/retry state without blocking the scan or a later plan.
- **Location resolves outside Germany** (e.g. a GPS-tagged photo taken abroad) → no enrichment; summary states conditions aren't available for non-DE locations.
- **One source slow, others fast** → independent queries; the summary fills in per-field as each returns rather than waiting for the slowest.
- **External source returns malformed/empty/ambiguous data** (e.g. soil type not mappable to the five buckets, no nearby DWD station) → treat as "unavailable" for that field, never store a garbage value; log for diagnosis.
- **User edits location repeatedly in quick succession** → only the latest location's enrichment should win (avoid a stale earlier response overwriting a newer one).
- **User deletes the scan mid-enrichment** → enrichment result is discarded; no orphaned enrichment row (cascade with the scan, mirroring PROJ-3's delete).
- **Hardiness zone and climate are correlated** (zone can be derived from annual minimum temperature) → if a dedicated zone source isn't available, zone may be derived from the climate min-temp rather than failing independently (architecture to confirm — see Open Questions).
- **Same postcode enriched for many users** → identical soil/zone/climate; a caching layer is desirable to avoid re-hitting external APIs (architecture concern, not user-visible).
- **External API rate limiting** (esp. the shared Nominatim/DWD/BGR public endpoints) → must be controlled server-side; an abusive user must not get the app's IP throttled (carries PROJ-3's INFO-1 concern).

## Technical Requirements (optional)
- **Server-side integrations:** the three external lookups (and any geocoding) run **server-side** — for API-identity/rate-limit control, caching, CORS avoidance, and to keep each source swappable — consistent with how PROJ-3's `/api/geocode` was built. (Final placement is `/architecture`'s decision.)
- **Security:** enrichment data inherits owner-only RLS via the scan it belongs to; endpoints are auth-gated; no secrets expected (all three sources are free/open — confirm at `/architecture`).
- **Resilience:** per-source timeouts and graceful partial results; never block save or plan generation on enrichment.
- **AI-ready shape:** stored as structured fields so PROJ-6's rule engine reads them directly and a future model could augment/replace a source without schema or UI change (per the PRD's "Plan generation" swap-in note).
- **Geography:** Germany-scoped sources (BGR, DWD, German hardiness zones); non-DE locations yield no data.

## Open Questions
<!-- Unresolved questions from the spec interview. Close them in /refine or /architecture when answered. -->
- [ ] **BGR soil endpoint (BLOCKING — carried from INDEX).** Which BGR service/dataset returns soil type by coordinate for Germany, in what format (WMS/WFS/REST?), at what resolution, and with what usage limits? If no usable point-query exists, what's the fallback (a coarser soil map, a different open dataset)? Design soil behind a swappable seam until resolved.
- [ ] **DWD climate access.** Which DWD product gives climate **normals** (avg annual rainfall, typical annual min temp, frost window) by location — gridded data vs nearest-station, and how is a location mapped to a value? Access/format/limits?
- [ ] **Hardiness zone source.** Is there an authoritative German/European hardiness-zone dataset to query, or should the zone be **derived** from the DWD annual-minimum-temperature normal (zone is a function of min temp)? Deriving it removes a third integration — confirm at `/architecture`.
- [ ] **Caching / shared reference data.** Soil, zone, and climate are identical for a given location — should results be cached (by coordinate or postcode) across scans/users to cut external calls? (Architecture.)
- [ ] **Rate limiting on enrichment + geocode endpoints.** Carries PROJ-3's INFO-1 ("Nominatim at scale") and extends it to BGR/DWD — add a per-user throttle and/or self-host before scaling beyond the v1 beta.
- [ ] **Optional soil pH band.** Include a coarse pH band if BGR returns it cheaply, or drop entirely for v1? (Confirm against PROJ-6's actual needs.)

## Decision Log
<!-- Record of conscious decisions made and why. Added to by /write-spec and /architecture. -->

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| Show a **compact, read-only conditions summary** on the scan detail (soil · zone · climate) | Builds trust and serves Thomas's "show me the evidence" need, while staying low-friction for Maya; gives PROJ-4 a small real UI surface without the cognitive overload the PRD warns against | 2026-06-18 |
| Enrich **automatically in the background on scan save**, with a "Gathering conditions…" pending state; never block the save | Keeps the under-5-minute journey fast; external-API latency never becomes the user's wait | 2026-06-18 |
| Location basis = **precise GPS if present, else forward-geocode the postcode** to a centroid | Best accuracy where GPS exists; postcode (always present) guarantees every scan can be enriched — GPS-only would starve the many scans whose EXIF GPS was stripped | 2026-06-18 |
| **Independent sources, partial results OK**, with a retry; never block plan generation | Three separate services (BGR especially) can fail independently; resilience matters more than completeness, and PROJ-6 decides how to handle gaps | 2026-06-18 |
| **Re-enrich only when location changes** (postcode or photo); no time-based refresh | Soil, hardiness zone, and climate normals are static per location — location is the only input that changes the result; avoids wasted external calls | 2026-06-18 |
| **"Weather" = long-term climate characterisation (normals), not live/forecast weather** | Planting decisions depend on rainfall/frost/min-temp patterns, not today's conditions; also keeps live-weather/nudges (a v2 non-goal) out of scope | 2026-06-18 |
| v1 data set: **soil type** (sand/loam/clay/silt/peat, +optional pH band), **climate** (avg annual rainfall mm, typical annual min °C, frost window), **hardiness zone** label | Scoped to what a planting rule engine (PROJ-6) needs to filter plants; richer signals (moisture, sun-hours, temp curves) deferred until PROJ-6 proves the need | 2026-06-18 |
| **No manual override** of enriched values in v1 (only location is user-editable) | Trust the open-data sources; editing location already covers correcting a wrong result; hand-editing soil/zone adds UI and ambiguity for little MVP value | 2026-06-18 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| _To be added by `/architecture`_ | | |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
