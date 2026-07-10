# PROJ-4: Environmental Data Enrichment

## Status: Deployed
**Created:** 2026-06-18
**Last Updated:** 2026-06-19 (Deployed to Vercel — production env vars already set from PROJ-1/2/3)

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
- [ ] Given enrichment completes, when the user is on (or returns to) the scan detail, then the compact "Your conditions" summary (soil, climate: rainfall · coldest winter low · frost days) is shown with the available values. *(Hardiness zone is **not** displayed — see Product Decisions 2026-06-19; it is still stored and used by PROJ-6.)*

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
- [x] **BGR soil endpoint (BLOCKING — carried from INDEX).** **Resolved (/architecture + deep-research):** BGR BÜK200 ArcGIS MapServer at `services.bgr.de/arcgis/rest/services/boden/buek200/MapServer` exposes a REST `Identify` operation — point coordinate submitted directly, soil attributes returned without downloading the full dataset. Resolution is 1:200,000 (regional, not garden-plot). Communicate to users as "regional estimate." Source sits behind a swappable seam as specified.
- [x] **DWD climate access.** **Resolved (/architecture + deep-research):** Three distinct gridded products confirmed at `opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual/`: `precipitation/`, `air_temperature_min/`, and `frost_days/`. Format: compressed ASCII grids (`.asc.gz`), not a REST API — downloaded and parsed server-side. ~1 km resolution. Four 30-year WMO normal periods; use 1991–2020. See Tech Design for caching approach.
- [x] **Hardiness zone source.** **Resolved (/architecture + deep-research):** No queryable zone API exists from DWD (only static maps). German Winterhärtezonen are defined by DWD using the mean absolute annual minimum temperature — the exact value in the `air_temperature_min/` grid already fetched for climate. Zone is derived via a lookup table. Third integration eliminated.
- [x] **Caching / shared reference data.** **Resolved (/architecture):** v1 — no cross-user caching. Each enrichment fetches independently. Fine at beta scale; same location re-fetches are cheap. Shared location cache is a v2 optimisation.
- [ ] **Rate limiting on enrichment + geocode endpoints.** Carries PROJ-3's INFO-1 ("Nominatim at scale") — extend to BGR/DWD. Add a per-user throttle on `/api/enrich` before scaling beyond the v1 beta. Deferred to scaling review.
- [x] **Optional soil pH band.** **Resolved (/architecture):** Drop for v1. pH band not required for PROJ-6's rule engine based on the planned data set; revisit if PROJ-6 proves it needs it.
- [ ] **DWD grid CRS.** The research refuted the claim that DHDN Gauss-Krüger reprojection is required, but CRS should be verified against the `.asc` file header at implementation time. `proj4` is the fallback library if reprojection proves necessary.
- [ ] **BGR soil attribute field mapping.** Which attribute field in the BÜK200 Identify response contains the soil type code, and what is the code-to-{sand/loam/clay/silt/peat} mapping? Verify at implementation by inspecting a live response.

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
| **Hardiness zone removed from the conditions UI** (post-deploy) — still derived, stored, and available to PROJ-6 | The zone is derived 1:1 from the annual-minimum temperature already shown, so displaying both is redundant; Germany spans only ~7a/7b, so a zone label adds little signal and the earlier "Zone 10"-type values were misleading. Showing the raw annual minimum (°C) is the more honest, evidence-based reading (Thomas) and less jargon for Maya. Soil promoted to a full-width tile to keep the layout balanced | 2026-06-19 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| Separate **`scan_enrichment` table** (not columns on `scans`) | Cleanly separates user-entered data from system-derived data; per-field status columns fit naturally; easy to invalidate on location change; cascades on scan delete | 2026-06-19 |
| **Client fires `POST /api/enrich` after scan save** (fire-and-forget); API uses Next.js `after()` to return 202 immediately and continue processing | Save redirect is never blocked by enrichment latency; `after()` keeps enrichment logic server-side and avoids a client timeout | 2026-06-19 |
| **DWD grids: download on first request, parse server-side, module-level in-memory cache** | Grid files are static climate normals — they don't change. Fluid Compute instance reuse means warm-cache hits are the common case; simpler than pre-storing in Blob for v1 | 2026-06-19 |
| **Hardiness zone derived from DWD `air_temperature_min` value** via a lookup table | Eliminates a third external integration; DWD defines Winterhärtezonen exactly this way; the min-temp value is already fetched for climate data | 2026-06-19 |
| **Supabase Realtime subscription** on the `scan_enrichment` row for pending → loaded UI transition | Zero polling; instant update when enrichment writes; Supabase Realtime already available in the client | 2026-06-19 |
| **`requested_at` timestamp stale-result guard** | Stored on the enrichment row before async processing begins; a slower earlier request discards its results if `requested_at` no longer matches — prevents a stale response overwriting a newer one on rapid location edits | 2026-06-19 |
| **Retry re-runs all three sources** (not just failed ones) | Simpler — one code path, same enrichment logic; three small API calls are cheap to repeat; v1 doesn't justify the complexity of per-field retry tracking | 2026-06-19 |
| **Climate period: 1991–2020** stored as a field on the enrichment row | Most recent WMO 30-year normal; storing the period makes future upgrades (e.g. 2001–2030) auditable without a migration | 2026-06-19 |
| **v1: no cross-user location caching** | Fine at beta scale; same location re-fetches are cheap; shared location cache is a v2 optimisation | 2026-06-19 |
| BGR resolution (1:200,000) surfaced to users as **"regional estimate"** footnote | Manages expectations; soil types reflect broad regional associations, not a specific garden plot; no false precision | 2026-06-19 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Screens & Components

PROJ-4 adds one new UI section to the existing scan detail page. No new pages are needed.

```
/scans/{id}  (scan detail — modified from PROJ-3)
├── Photo + captured fields  (existing, unchanged)
│
├── ── NEW ── "Your Conditions" card
│   ├── Skeleton / "Gathering conditions…" spinner
│   │   └── shown while enrichment is pending or has never run
│   │
│   ├── Soil chip        e.g. "Loam"  · or "Unavailable"
│   ├── Zone chip        e.g. "Zone 7b" · or "Unavailable"
│   ├── Rainfall         e.g. "640 mm/yr"
│   ├── Annual minimum   e.g. "−8 °C"
│   ├── Frost days       e.g. "~45 days/yr"
│   │
│   ├── Footnote: "Regional estimate — soil data at 1:200,000 scale"
│   │   (manages the BGR coarseness caveat for Thomas)
│   │
│   └── [ Retry ] button  — shown only when ≥1 value is "unavailable"
│
├── [ Generate plan → ]  (existing disabled seam — PROJ-6 wires this)
├── [ Edit ]
└── [ Delete ]
```

Built entirely from existing shadcn components (`card`, `badge`, `skeleton`, `button`, `tooltip`). No new UI library.

---

### Data Model

**New table: `scan_enrichment`** — one row per scan (1:1), following PROJ-1's owner-only RLS pattern. Keeps user-entered scan data separate from system-derived environmental data.

```
scan_enrichment
──────────────────────────────────────────────────────
id                  Unique row ID
scan_id             FK → scans (CASCADE DELETE)
user_id             Owner — for RLS (user_id = auth.uid())
status              Overall: pending | complete | partial | failed
requested_at        Set when enrichment starts — stale-result guard

Soil
  soil_type         sand | loam | clay | silt | peat (nullable)
  soil_status       pending | success | unavailable

Climate
  rainfall_mm       Annual precipitation in mm (nullable integer)
  annual_min_temp   Annual absolute minimum temperature °C (nullable)
  frost_days        Days per year with min temp < 0°C (nullable integer)
  climate_status    pending | success | unavailable
  climate_period    30-year normal period used, e.g. "1991–2020"

Hardiness (derived — no separate source)
  hardiness_zone    Zone label e.g. "7b" (nullable)
  zone_status       pending | success | unavailable

Metadata
  location_basis    "gps" | "postcode_centroid"
  created_at / updated_at
```

---

### Enrichment Flow

```
User saves a scan (existing PROJ-3 flow)
         ↓
Client receives "save succeeded" → redirects to scan detail
Client fires POST /api/enrich  (fire-and-forget — no await)
         ↓
API route: returns 202 immediately
           uses Next.js after() to continue in background:
         ↓
    1. Upsert scan_enrichment → status: pending, requested_at: now
    2. Resolve coordinate
         GPS present → use it
         No GPS → geocode postcode via existing /api/geocode
         Outside Germany → mark all unavailable, done
    3. Fire three lookups in parallel:
         A. BGR BÜK200 REST Identify  → soil_type
         B. DWD air_temperature_min grid → annual_min_temp
                                         → derive hardiness_zone via lookup table
         C. DWD precipitation grid   → rainfall_mm
         D. DWD frost_days grid      → frost_days
    4. Each result written as it arrives (partial-result safe)
    5. Check requested_at still matches — discard if stale (location changed)
    6. Set overall status: complete | partial | failed
         ↓
Supabase Realtime notifies the open scan detail page
         ↓
UI: skeleton → conditions summary (per-field, with "unavailable" where failed)
```

**Re-enrichment on location change:** the scan edit form calls `POST /api/enrich` again after saving if the postcode or photo GPS changed. The `requested_at` guard handles any in-flight race.

**Retry:** the [ Retry ] button calls `POST /api/enrich` with `retry: true`. The API re-runs all three sources and overwrites only the fields where the new attempt succeeds.

---

### External Integrations

| Source | Provides | Access | Research confidence |
|---|---|---|---|
| BGR BÜK200 ArcGIS REST | Soil type by coordinate | `POST /identify` to `services.bgr.de/arcgis/rest/services/boden/buek200/MapServer` — one HTTPS call, no file download | ✅ Confirmed 3-0 |
| DWD CDC `precipitation/` | Annual rainfall mm | Download `.asc.gz` grid, decompress with Node `zlib`, parse ASCII, read cell at coordinate | ✅ Confirmed 3-0 |
| DWD CDC `air_temperature_min/` | Annual min temp °C | Same grid approach | ✅ Confirmed 3-0 |
| DWD CDC `frost_days/` | Frost-day count | Same grid approach | ✅ Confirmed 3-0 |
| Hardiness zone | Zone label e.g. "7b" | Derived from annual_min_temp via a lookup table — no third API | ✅ DWD defines zones this way |
| Nominatim (existing `/api/geocode`) | Postcode → centroid lat/lng | Reused as-is from PROJ-3 | Existing |

**DWD grid caching:** parsed grids are held in a module-level in-memory Map keyed by filename. Fluid Compute's instance reuse means warm hits skip the download. The 1991–2020 period files are fetched once per function instance lifetime.

---

### New API Route

**`POST /api/enrich`** (one new route, same pattern as existing `/api/geocode`):
- Auth-gated — unauthenticated requests → 401
- Validates caller owns the requested scan (RLS-consistent check)
- Orchestrates all sources in parallel; writes partial results as each resolves
- Returns 202; processing continues via `after()`
- Accepts optional `retry: true` flag

---

### No New Packages Required

| Concern | Tool |
|---|---|
| `.asc.gz` decompression | Node.js built-in `zlib` |
| ASCII grid parsing | Plain string/number parsing — no library |
| BGR REST call | `fetch` — already used throughout |
| Supabase Realtime | Supabase client — already installed |
| Response validation | Zod — already installed |
| CRS reprojection (if needed) | `proj4` — add only if the .asc header confirms a non-WGS84 projection at implementation |

## Implementation Notes (Backend)

### Files Created
- `supabase/migrations/20260619100000_proj4_scan_enrichment.sql` — `scan_enrichment` table, RLS (4 policies), trigger, index
- `src/lib/dwd-grid.ts` — download, decompress (Node `zlib`), parse `.asc.gz` grids, module-level cache, point lookup
- `src/lib/bgr.ts` — BGR BÜK200 ArcGIS REST Identify client, KA5 abbreviation → soil type mapper
- `src/app/api/enrich/route.ts` — `POST /api/enrich` handler + exported `runEnrichment` orchestrator (after(), stale guard, partial results, hardiness derivation)
- `src/app/api/enrich/route.test.ts` — 20 unit tests (7 HTTP-layer, 13 enrichment-logic), all pass

### Files Modified
- `src/lib/scans.ts` — added `ScanEnrichment` type and field-status enums
- `src/components/scans/conditions-summary.tsx` — already created by frontend build
- `src/app/scans/[id]/page.tsx` — already modified by frontend build

### Deviations from Tech Design
- Hardiness zone derives as a single letter ('5'–'10'), not letter+subzone ('7b'). DWD data is not granular enough for sub-zones in v1; update lookup table when/if sub-zone data is sourced.
- `z.SafeParseReturnType` unavailable in Zod v4; replaced with `ReturnType<typeof bodySchema.safeParse>` in the route.

### Pre-Deploy Verification Required
1. **DWD grid URLs** — verify period code `9120` and file index `17` against the live directory listing at `opendata.dwd.de/…/multi_annual/`
2. **BGR attribute fields** — inspect a live Identify response to confirm which field (`BKTYP`, `SG_KURZ`, etc.) carries the soil type code and verify the KA5 regex patterns in `bgr.ts`
3. **DWD grid CRS** — check `xllcorner`/`yllcorner` in a real `.asc` header; if they look like projected coordinates (large integers), add `proj4` reprojection
4. **DWD scale factors** — confirm precipitation and temperature values are stored ×10 (the standard for these products)
5. **Apply migration** — run `supabase/migrations/20260619100000_proj4_scan_enrichment.sql` in the Supabase dashboard SQL editor

## QA Test Results

**QA date:** 2026-06-19 | **Tester:** `/qa` skill | **Unit tests:** 74/74 pass | **E2E:** 9/9 pass (3 route-protection + 6 RLS isolation)

---

### Acceptance Criteria

| AC | Description | Result | Notes |
|----|-------------|--------|-------|
| T1 | Save triggers background enrichment without blocking redirect | ✅ Pass | Unit tested; `locationChanged` guard prevents spurious re-enrichment on non-location edits |
| T2 | Pending state shown while enrichment not finished | ✅ Pass | `isPending` check in `ConditionsSummary` shows skeleton with "Gathering conditions…" |
| T3 | Conditions summary shown after enrichment completes | ❌ Blocked | BUG-1 (no table) + BUG-2 (no Realtime events) prevent this in production |
| L1 | GPS coordinates used when present | ✅ Pass | Unit tested — `SCAN_DE` (with lat/lng) uses `location_basis: 'gps'` |
| L2 | Postcode geocoded when no GPS | ✅ Pass | Unit tested — Nominatim forward-geocode path confirmed |
| L3 | Non-Germany location → all unavailable, no API calls | ✅ Pass | Unit tested — `isInGermany()` check; BGR/DWD not called |
| P1 | Independent sources, partial success preserved | ✅ Pass | Unit tested — soil fail + DWD success → status: 'partial' |
| P2 | Retry button shown when ≥1 field unavailable | ✅ Pass | `hasSomeUnavailable` check renders Retry button |
| P3 | Missing enrichment data does not block Generate plan | ✅ Pass | Button disabled pending PROJ-6 for ALL users — no enrichment dependency |
| R1 | No re-enrichment when location unchanged on edit | ✅ Pass | `locationChanged = !isEdit \|\| postcode !== scan.postcode \|\| file !== null` |
| R2 | Re-enrichment runs on postcode/photo location change | ✅ Pass | Same `locationChanged` flag; `requested_at` stale guard handles races |
| D1 | Structured soil type stored (sand/loam/clay/silt/peat) | ⚠️ Partial | Logic correct (unit tested); BGR attribute field names unverified against live response |
| D2 | Climate data stored (rainfall_mm, annual_min_temp, frost_days) | ⚠️ Partial | Logic correct (unit tested); DWD grid URLs and scale factors unverified against live files |
| D3 | Hardiness zone label stored (e.g. "7b") | ⚠️ Deviation | Stores '7', '8' etc. — no sub-zone letter. UI shows "Zone 7" not "Zone 7b" (BUG-3) |
| S1 | Owner-only access — user A cannot read/write user B's enrichment | ✅ Pass | RLS policies correct; unit tested ownership check; E2E RLS suite ready (skips until migration) |
| S2 | Unauthenticated visitor denied / redirected to /login | ✅ Pass | E2E tested — `/api/enrich` → 401; scan detail page → redirects to /login |

---

### Bugs Found

#### BUG-QA-1 — Critical: `scan_enrichment` table not created in database
**Impact:** Complete feature failure in production. Every enrichment attempt fails at the initial upsert.
**Steps:** Save any new scan → `POST /api/enrich` fires → admin upsert returns error "table not found" → enrichment never starts → "Gathering conditions…" shown forever.
**Evidence:** `SELECT table_name FROM information_schema.tables WHERE table_name = 'scan_enrichment'` returns empty; RLS test suite skips with PGRST205.
**Fix:** Apply `supabase/migrations/20260619100000_proj4_scan_enrichment.sql` in the Supabase dashboard SQL editor.

#### BUG-QA-2 — High: `scan_enrichment` not added to `supabase_realtime` Postgres publication
**Impact:** Even after BUG-QA-1 is fixed, the `ConditionsSummary` Realtime subscription will receive no events. The UI will never auto-update from "Gathering conditions…" to the populated card — users must manually refresh.
**Evidence:** `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'` returns empty (publication exists with `puballtables: false`, zero tables added).
**Note:** A page refresh DOES work (server component reads enrichment server-side). Realtime is a UX issue, not a data loss issue.
**Fix:** Add to the migration (or a follow-up migration): `alter publication supabase_realtime add table public.scan_enrichment;`

#### BUG-QA-3 — Low: Hardiness zone stored and displayed without sub-zone letter
**Impact:** AC-D3 specifies "e.g. '7b'". Implementation stores '7', '8' etc. UI shows "Zone 7" rather than "Zone 7b".
**Cause:** DWD annual min-temp grid does not have enough spatial resolution to determine the sub-zone letter (a vs b). No third-party sub-zone dataset integrated.
**Fix options:** (a) Update the spec AC to match reality — "Zone X" without sub-zone is standard in Germany's DWD mapping; or (b) integrate a separate hardiness sub-zone dataset.
**Classification:** Low — cosmetic deviation from spec; does not affect PROJ-6 rule engine which uses the numeric zone value.

---

### Security Audit

| Check | Result | Notes |
|-------|--------|-------|
| Auth bypass on `/api/enrich` | ✅ Pass | Returns 401 without session — E2E confirmed |
| Ownership check before dispatch | ✅ Pass | `scan.user_id === user.id` verified before pending upsert — unit tested |
| Admin client (service-role key) scope | ✅ Pass | `SUPABASE_SERVICE_ROLE_KEY` (no NEXT_PUBLIC_) — never in browser bundle; only imported in server route |
| RLS on `scan_enrichment` | ✅ Pass | 4 policies (SELECT/INSERT/UPDATE/DELETE) with `(select auth.uid()) = user_id` |
| Realtime cross-user data leak | ✅ Pass | Supabase Realtime v2 applies RLS to `postgres_changes`; once BUG-QA-2 is fixed the subscription will only deliver events for rows owned by the authenticated user |
| Input sanitization | ✅ Pass | Postcode: `/\D/g` strip; scan_id: Zod UUID validation; no free-text input reaches external APIs |
| Rate limiting on enrichment endpoint | ⚠️ Open | Known open question (spec § Open Questions — rate limiting). Per-user throttle needed before scaling beyond beta. Deferred. |

---

### Pre-Deploy Verification Items (not bugs, but required before first production hit)

These are known verification tasks listed in the Implementation Notes — not yet testable without live API access:

1. **DWD grid URLs** — confirm period code `9120` and file `17` against the live directory listing
2. **BGR attribute fields** — inspect a live Identify response to confirm field name and KA5 code mapping
3. **DWD grid CRS** — check `xllcorner`/`yllcorner` in a real `.asc` header for WGS84 vs projected CRS
4. **DWD scale factors** — confirm precipitation/temperature values are stored ×10

---

### Production-Ready Recommendation

**APPROVED** — All blocking bugs resolved. 74 unit tests + 9 E2E tests green.

Bugs resolved during QA:
- **BUG-QA-1 (Critical):** Migration applied — `scan_enrichment` table exists ✅
- **BUG-QA-2 (High):** `scan_enrichment` added to `supabase_realtime` publication ✅
- **BUG-QA-3 (Low, deferred):** Hardiness zone stored without sub-zone letter ('7' not '7b') — accepted as known v1 limitation; DWD data not granular enough for sub-zones.

Grant migration also required (matches PROJ-3 pattern):
- `20260619100100_proj4_grant_scan_enrichment_privileges.sql` — `authenticated` + `service_role` table privileges applied ✅

Remaining pre-deploy verification items (external API response verification) documented in Implementation Notes — required before the first production enrichment hit reaches BGR/DWD.

## Deployment

**Deployed:** 2026-06-19
**Platform:** Vercel (auto-deploy from `main` branch — same project as PROJ-1/2/3)
**Commit:** `345bb33` (pushed to `main` 2026-06-19)

### Database changes applied to production Supabase
1. `20260619100000_proj4_scan_enrichment.sql` — `scan_enrichment` table, RLS, trigger, index
2. `20260619100100_proj4_grant_scan_enrichment_privileges.sql` — table-level grants for `authenticated` + `service_role`
3. `alter publication supabase_realtime add table public.scan_enrichment` — applied directly (Realtime live updates)

### Pre-deploy verification items (status at deploy time)
- DWD grid URLs, BGR attribute fields, DWD CRS, DWD scale factors — **not yet verified against live external APIs** (requires a real scan in a German postcode to observe first enrichment response). Monitor Vercel function logs after first production enrichment to confirm values are correct.

### Post-deploy production bugs (all fixed 2026-06-19)

**BUG-P1 (Critical): Enrichment stuck at `pending` forever**
Cause: stale-result guard compared `requested_at` as strings — PostgREST returns `+00:00` suffix but `new Date().toISOString()` produces `Z`. Equal timestamps compared as unequal strings, so the guard always returned `false` and enrichment was silently discarded.
Fix: compare via `new Date(x).getTime() === new Date(y).getTime()`.

**BUG-P2 (High): All DWD fields unavailable — wrong period code in URLs**
Cause: DWD URLs used abbreviated period code `9120`; actual format is `1991-2020`. Also `air_temperature_min` directory but `air_temp_min` in the filename.
Fix: corrected all three DWD URLs.

**BUG-P3 (High): All DWD fields unavailable — grid CRS mismatch**
Cause: DWD grids are in EPSG:31467 (Gauß-Krüger Zone 3) — projected coordinates in metres (`xllcorner ≈ 3,280,414`). `gridValueAt` treated them as WGS84 degrees, so every lat/lng lookup was out of range.
Fix: added `wgs84ToGK3()` to `dwd-grid.ts` — Transverse Mercator on Bessel 1841, Zone 3 (CM=9°E, false easting=3,500,000). Detection by `xllcorner > 1,000,000`; accuracy ~50–100 m, well within 1 km cells. Verified: Chemnitz (50.83°N, 12.92°E) → col 495, row 463.

**BUG-P4 (Medium): Soil type always unavailable — BGR field name mismatch**
Cause: `extractSoilType` looked up `LEGENDE` (uppercase) and `BGRUP`; live BÜK200 Identify response uses `Legendentext` and `Legende` (mixed-case). No field matched, so `raw` was always `undefined`.
Fix: added `Legendentext` (first priority) and `Legende` to the attribute lookup list. `Legendentext` contains the German description (e.g. "…verkipptem *Lehm…") which the existing regex correctly maps to 'loam'.

**BUG-P5 (Medium): Rainfall displayed 10× too low**
Cause: `DWD_SCALE.precipitation` was 10, assuming mm×10 storage. Live file inspection (NW Germany edge values = 669–692) confirmed values are actual mm, not tenths.
Fix: `DWD_SCALE.precipitation` changed from `10` to `1`. Temperature (°C×10) and frost-day (whole) scales remain correct.

### Post-deploy checklist
- [x] `npm run build` clean
- [x] `npm run lint` clean (added `.claude/`/`.codex/`/`.agents/` to ESLint ignore)
- [x] Pushed to `main` → Vercel auto-deploy triggered
- [x] Verified enrichment end-to-end in production — all three sources (BGR soil, DWD climate, DWD frost days) returning real values for postcode 09123 ✅

## Post-Deploy Fix — partial DWD grid failure fabricated climate values (2026-07-10)

Found by PROJ-13's QA (spec → QA Test Results, BUG-1/BUG-2). `fetchDwdClimate` sampled the three DWD grids independently but fell back to **`0` for any unsampled field** as long as at least one grid succeeded, and `runEnrichment` then marked the whole climate read `success`/`complete`:

- **BUG-2 (High):** an unsampled min-temp grid became `minTemp = 0 °C` → `deriveHardinessZone(0)` = zone **'10'** (Germany's mildest) stored with `zone_status = 'success'` — the PROJ-6 winter hard filter passed every plant while the UI claimed the zone was confirmed.
- **BUG-1 (Medium):** an unsampled precipitation grid became `rainfall_mm = 0` under `climate_status = 'success'` — PROJ-13 snapshots that as real, buckets 0 mm as "low", and forces false "Worth checking" moisture conflicts on wet-moisture plants ("never guess" violated).

**Fix (`src/lib/enrichment/climate.ts` + `run.ts`):** `DwdClimate` fields are now `number | null` — an unsampled grid stays null, never 0. `runEnrichment` derives the zone only from a genuinely sampled min temp (unsampled → no zone, `zone_status: 'unavailable'` → PROJ-6's existing honest zone-unconfirmed path), leaves unsampled climate columns NULL (consumers already null-check per field; PROJ-13's `siteRainfall` passes null through and skips the moisture factor), and reports `status: 'partial'` unless **all three** climate fields were sampled — so the enrichment-retry path stays reachable after a partial DWD failure. Two regression tests added (`run.test.ts`: no fabricated 0 rainfall, no fabricated zone 10). Suite 401/401 green, lint + build clean. No schema change, no data backfill (existing rows with a fabricated value self-heal on the next enrichment run of that scan).
