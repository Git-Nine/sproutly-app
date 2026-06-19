# PROJ-4: Environmental Data Enrichment

## Status: In Review
**Created:** 2026-06-18
**Last Updated:** 2026-06-19 (Backend built — migration, API route, DWD grid parser, BGR client, 20/20 unit tests)

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
_To be added by /qa_

## Deployment
_To be added by /deploy_
