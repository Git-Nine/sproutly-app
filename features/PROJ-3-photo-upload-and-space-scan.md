# PROJ-3: Photo Upload & Space Scan

## Status: Deployed
**Created:** 2026-06-18
**Last Updated:** 2026-06-18 (Deployed to Vercel — production env vars set; magic-link sign-in verified live)

## Dependencies
- Requires: **PROJ-1 (Supabase Infrastructure Setup)** — the private, user-namespaced `photos` bucket and the RLS ownership pattern (`user_id = auth.uid()`) this feature's new `scans` table must follow.
- Requires: **PROJ-2 (User Authentication & Profile)** — a scan belongs to a logged-in user; the whole feature lives behind the auth gate.

> **Note for `/architecture`:** PROJ-3 creates the **`scans` table** (deferred to this feature by PROJ-1's Out of Scope). It follows PROJ-1's RLS convention. No new storage bucket — scan photos reuse the existing private `photos` bucket at `{user_id}/scans/{scan_id}`.

## User Stories
- As **Maya (the Guilty Non-Starter)**, I want to snap or upload one photo of my space and answer a few quick questions, so that I can hand the planning over without overthinking it.
- As **Thomas (the Pragmatic Rockery Defender)**, I want to record that my space is currently gravel and describe its conditions accurately, so that any later plan is grounded in my real situation.
- As a **logged-in user with several spaces**, I want to scan more than one area (front garden, balcony) and see them as a list, so that I can plan each independently.
- As a **returning user**, I want to view, correct, and delete my saved scans, so that my spaces stay accurate over time.
- As a **privacy-conscious user**, I want my space photos stored privately under my own account, so that no one else can see my home.
- As a **first-time user with no scans yet**, I want a clear prompt to create my first scan, so that I know exactly how to start the journey.

## Out of Scope
- **Environmental enrichment** (soil via BGR, weather via DWD, hardiness zone) — **PROJ-4**. PROJ-3 captures the user's manual inputs and the location; PROJ-4 augments a saved scan with derived data.
- **Plan generation and the working "Generate plan" action** — **PROJ-6**. PROJ-3 renders the seam only: a visible, disabled "Generate plan" affordance on the scan detail that PROJ-6 wires up. No plan logic here.
- **AI vision auto-population** of the scan fields from the photo — deferred swap-in point (PRD v1 non-goal). The manual form and the photo are designed so a vision model later fills the *same* fields.
- **Multiple / multi-angle photos per scan** — one photo per scan in v1; multi-angle is a later iteration once AI vision lands.
- **Progress photos / re-photographing a space over time** — **PROJ-9**.
- **Photo editing** — cropping, filters, rotation, annotation.
- **Sharing scans, public spaces, or collaboration** — not in v1.
- **Per-scan maintenance preference** — the profile holds the single default (PROJ-2); per-space capture is out of scope.
- **Non-Germany locations** — postcode validation is German PLZ (5 digits) only, per the Germany-first constraint.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Creating a scan
- [ ] Given a logged-in user on the new-scan screen, when they provide a photo and fill the required fields (location, sun exposure, current surface, space type, size) and save, then the scan is stored and they land on its detail view with a "Space saved" confirmation.
- [ ] Given a logged-in user on the new-scan screen, when they skip the photo (it is marked optional) and fill the required fields and save, then the scan is stored with no photo and the detail/list views render a neutral "No photo added" placeholder. *(Added 2026-06-24 — see Post-Deploy Enhancement.)*
- [ ] Given a logged-in user, when they start a new scan, then they can either take a photo with the camera or choose one from their library (mobile), or drag/drop / browse (desktop).
- [ ] Given a selected photo, when it loads, then a preview is shown with an option to retake/replace it before saving.
- [ ] Given a photo with EXIF GPS data, when it is selected, then the coordinates are reverse-geocoded to prefill the postcode field (which the user can still edit/confirm) and retained for later enrichment (PROJ-4); the capture date is also read.
- [ ] Given a photo with no GPS or a geocoding lookup that fails, when it is selected, then the postcode field is left empty for manual entry and no error blocks the scan.

### Photo validation
- [ ] Given a file that is an allowed image type (JPEG/PNG/WebP/HEIC) under 10 MB, when the user adds it, then it is accepted.
- [ ] Given a disallowed file type or a file over 10 MB, when the user adds it, then an error is shown and no upload occurs.
- [ ] ~~Given the user tries to save without a photo, when they submit, then a validation error is shown and nothing is saved.~~ **Superseded 2026-06-24:** the photo is now optional — saving without one succeeds (see Post-Deploy Enhancement). The other required fields still block save when missing.

### Field validation
- [ ] Given an empty or non-German postcode (not exactly 5 digits), when the user saves, then a validation error is shown and nothing is saved.
- [ ] Given any required choice field (sun exposure, current surface, space type) left unselected, when the user saves, then a validation error names the missing field and nothing is saved.
- [ ] Given the approximate area (m²) is empty, zero/negative, non-numeric, or outside the allowed range, when the user saves, then a validation error is shown and nothing is saved.
- [ ] Given an optional space name over its character limit, when the user saves, then a validation error is shown.

### Listing, viewing & editing
- [ ] Given a user with one or more saved scans, when they open "My Spaces", then each scan is listed with its photo thumbnail, name/space type, and a short summary (e.g. sun · surface).
- [ ] Given a user viewing a scan's detail, when the screen loads, then the photo, all captured fields, and a disabled "Generate plan" affordance marked as the next step are shown.
- [ ] Given a user editing a saved scan, when they change fields and/or replace the photo and save, then the changes persist and a confirmation is shown.
- [ ] Given a user with no scans, when they open "My Spaces", then an empty state invites them to create their first scan.

### Deleting a scan
- [ ] Given a user on a scan, when they choose "Delete", then a confirmation dialog appears before anything is removed.
- [ ] Given the confirmation dialog, when they confirm, then the scan record and its stored photo are both deleted and the user returns to the list.
- [ ] Given the confirmation dialog, when they cancel, then nothing is deleted.

### Security (carries PROJ-1's RLS/storage pattern)
- [ ] Given two users, when A is logged in, then A can list, view, edit, and delete only A's own scans, never B's.
- [ ] Given a scan photo, when it is uploaded, then it lives under the owner's namespace (`{user_id}/scans/...`) in the private bucket and is not accessible to other users.
- [ ] Given an unauthenticated visitor, when they navigate to any scan screen, then they are redirected to `/login` (per PROJ-2's middleware gate).

## Edge Cases
- **EXIF GPS stripped, absent, or geocoding fails/times out** (many platforms strip GPS on upload) → silently fall back to manual postcode entry; no error, no blocked scan.
- **EXIF GPS resolves outside Germany** → prefill is discarded (or flagged); user enters a German PLZ manually, consistent with the Germany-first constraint.
- **HEIC preview** — HEIC may not render in all browsers for the in-page preview → handle gracefully (e.g. generic placeholder thumbnail) without blocking the upload/save.
- **Photo uploads but the DB insert fails** → orphaned file; the fixed `{user_id}/scans/{scan_id}` path and/or cleanup keeps storage consistent (mirrors PROJ-2's avatar-orphan handling).
- **Network failure during upload or save** → error shown, the user's form input and selected photo are preserved.
- **User navigates away mid-scan** → unsaved scan is discarded (no draft persistence in v1); a confirm-before-leaving prompt is a nice-to-have.
- **Very large image on a slow mobile connection** → show upload progress; client-side downscale before upload is a possible optimization (architecture decision).
- **Corrupt / unreadable image file** → rejected with a clear error.
- **Concurrent edits to the same scan from two tabs** → last write wins (no locking in v1, consistent with PROJ-2).
- **Two scans of the same space type** (e.g. two balconies) → the optional name and/or created date disambiguate them in the list.
- **Deleting a scan that already has a plan** (future, once PROJ-6 exists) → cascade/cleanup is PROJ-6's concern; flagged for that feature.

## Technical Requirements (optional)
- **Security:** whole feature behind PROJ-2's auth gate; new `scans` table uses PROJ-1's owner-only RLS (`user_id = auth.uid()`); photos stay in the private bucket under the user's namespace, served via short-lived signed URLs.
- **Mobile-first:** primary viewport 390px; camera capture is a first-class path.
- **Geography:** German PLZ (5-digit) postcode validation; location data feeds PROJ-4 (Germany-scoped).
- **AI-ready shape:** the manual fields and stored photo are structured so a future vision model can populate the same fields without schema or UI changes.

## Open Questions
- [x] **Reverse-geocoding EXIF GPS → postcode** — **Resolved (/architecture):** server endpoint using Nominatim (OSM); server-side for rate-limit/app-identity control, caching, CORS-avoidance, and swappability. Manual entry/override always available; non-DE results discarded.
- [x] **Size representation** — **Resolved (/architecture):** approximate area as a whole number of m², range 1–5000. (Confirm with PROJ-6 that m² suits the rule engine; revisit there if needed.)
- [x] **Client-side image downscaling** — **Resolved (/architecture):** yes, via the browser canvas (no library); EXIF read before shrinking. HEIC is uploaded as-is (can't be shrunk outside Safari).
- [ ] **Nominatim at scale** — the public OSM instance is fine for the v1 beta but caps systematic/high-volume use; before scaling, self-host or move to a keyed provider. Revisit alongside PROJ-4's geo/soil/weather lookups.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Capture photo + 5 manual fields (location, sun, surface, space type, size) | Enough signal for the PROJ-6 rule engine and gives PROJ-4 the location to enrich; stays short enough for the under-5-minute / low-friction goal (Maya) | 2026-06-18 |
| Size captured as approximate area in square meters (numeric) | More precise input for the rule engine (plant counts/spacing) than coarse buckets; users can estimate m² for a typical garden/balcony | 2026-06-18 |
| ~~Photo required~~; manual fields required; space name optional | The photo and conditions are the point of a scan; a name is cosmetic and falls back to space type + date | 2026-06-18 |
| **Photo now optional** (manual fields still required) | Reduces friction for the "Guilty Non-Starter" (Maya) — she can start from the conditions answers alone. The photo is purely a visual reference in v1 (AI vision is a non-goal), so the plan journey doesn't depend on it; the manual fields still carry all signal PROJ-4/PROJ-6 need | 2026-06-24 |
| Capture *current surface* (incl. gravel/paved) | Directly serves the hardscape-to-garden conversion and grounds plans in reality (Thomas) | 2026-06-18 |
| Multiple scans per user with a history list, each independently editable/deletable | Matches the per-space journey; sets up PROJ-9 progress logging; each scan will get its own plan (PROJ-6) | 2026-06-18 |
| One photo per scan (multi-angle deferred) | Keeps capture fast and storage simple for v1; revisit when AI vision needs more angles | 2026-06-18 |
| Camera-or-library input; JPEG/PNG/WebP/HEIC ≤ 10 MB | Mobile-first capture; 10 MB (vs the 5 MB avatar) suits full-scene phone photos; HEIC is common on iPhone | 2026-06-18 |
| Auto-fill postcode by reverse-geocoding EXIF GPS, with manual entry/override as fallback | Photo-first magic: a GPS-tagged photo prefills location; manual entry still covers stripped/absent GPS and keeps the user in control. GPS also retained for PROJ-4 | 2026-06-18 |
| After save → scan detail with a disabled "Generate plan" CTA | A clean, visible seam for PROJ-6 to wire into; nothing fake shown to the user | 2026-06-18 |
| German PLZ-only location validation | Germany-first constraint; non-DE locations out of scope for v1 | 2026-06-18 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| New `scans` table, owner-only RLS (`user_id = auth.uid()`), following PROJ-1's pattern | Per-user isolation is the project-wide convention; deferred to PROJ-3 by PROJ-1's Out of Scope | 2026-06-18 |
| Scan CRUD client-side via Supabase (no per-entity API routes) | RLS + storage policy already enforce ownership; mirrors PROJ-2's profile-write decision and avoids redundant routes | 2026-06-18 |
| Photo at fixed per-scan path `{user_id}/scans/{scan_id}/photo`, overwrite on replace | One image file per scan → no orphan pile-up (same trick as PROJ-2's avatar); deleting a scan removes the file | 2026-06-18 |
| Scan id generated client-side up front (before upload/save) | Lets the storage folder and DB row share one id, so a failed save can't strand a file | 2026-06-18 |
| Read EXIF **before** shrinking the image | Canvas re-encoding strips EXIF; GPS/date must be captured from the original first | 2026-06-18 |
| Client-side image downscale via browser canvas (no library) | Faster mobile uploads + less storage; built-in canvas avoids a dependency | 2026-06-18 |
| HEIC uploaded as-is with placeholder preview (no client shrink/convert) | HEIC can't be drawn to canvas outside Safari; converting needs a heavy lib — defer to a later enhancement | 2026-06-18 |
| `exifr` for EXIF reading | Lightweight, browser-friendly, handles JPEG + HEIC metadata incl. GPS | 2026-06-18 |
| Reverse-geocoding via a **server endpoint** using **Nominatim (OSM)** | Open/free (fits the open-data approach); server-side controls Nominatim's required app-identity + rate limit, enables caching, avoids CORS, and keeps the geo integration swappable for PROJ-4 | 2026-06-18 |
| Approximate area = whole number of m², range 1–5000 | A residential garden/balcony fits well under 5000 m² (≈half a hectare); whole numbers suit a rough estimate and simplify validation | 2026-06-18 |
| Photo: JPEG/PNG/WebP/HEIC, ≤10 MB, one per scan; shown via short-lived signed URL | Confirms the spec's product decisions at the technical layer; private bucket → signed URL like PROJ-2 | 2026-06-18 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Screens & Components

```
/scans  (protected — "My Spaces")
├── Empty state — "Scan your first space" prompt + [ + New scan ]  ← shown when no scans
└── Scan list — one card per scan
    └── Scan card — thumbnail · name/space type · "sun · surface" summary

/scans/new  (protected)
└── Scan form
    ├── Photo picker — "Take photo" / "Choose from library" (mobile), drag-drop/browse (desktop)
    │   ├── Preview + "retake/replace"
    │   └── Upload progress bar
    ├── Postcode (PLZ) — auto-filled from the photo's GPS when available, always editable
    ├── Sun exposure — select (full / partial / shade)
    ├── Current surface — select (gravel / lawn / soil / paved / mixed)
    ├── Space type — select (front garden / back garden / balcony / bed)
    ├── Approximate area — number input, in m²
    ├── Name (optional)
    └── Save → /scans/{id}

/scans/{id}  (protected — scan detail)
├── Photo + all captured fields
├── [ Generate plan → ]   ← disabled "coming soon" seam; PROJ-6 wires this up
├── [ Edit ]  → same form, prefilled; can change fields and/or replace the photo
└── [ Delete ] → confirm dialog → removes the scan row + its photo, back to /scans
```

Built entirely from **existing** shadcn components (`form`, `input`, `select`, `button`, `card`, `alert-dialog`, `sonner`, `progress`, `skeleton`). No new UI library needed. The whole area sits behind PROJ-2's auth gate (middleware redirects unauthenticated visitors to `/login`).

### Data Model (plain language)

A new **`scans`** table, one row per scanned space, following PROJ-1's owner-only RLS pattern (a user can only ever see and touch their own scans). Each scan holds:

- **Unique ID** — generated up front (before any save) so the photo's storage folder and the database row share the same id
- **Owner** — the logged-in user it belongs to (the RLS ownership key)
- **Name** — optional, short; falls back to "space type + date" in the UI when empty
- **Photo reference** — the path of the photo inside the existing private `photos` bucket (not the image itself)
- **Postcode** — German PLZ (5 digits)
- **Latitude / longitude** — optional, from the photo's EXIF GPS; kept so **PROJ-4** can enrich soil/weather/zone without re-asking
- **Sun exposure** — full / partial / shade
- **Current surface** — gravel / lawn / soil / paved / mixed
- **Space type** — front garden / back garden / balcony / bed
- **Approximate area** — a whole number of square meters
- **Photo capture date** — optional, from EXIF
- **Created / updated timestamps**

**The photo image itself** lives in PROJ-1's existing **private `photos` bucket** at a fixed per-scan path (`{user_id}/scans/{scan_id}/photo`) — one image file per scan, overwritten on replace (same anti-orphan trick as PROJ-2's avatar). It's shown via a short-lived **signed URL** because the bucket is private. Deleting a scan removes both the row and that file.

### How the photo pipeline works (plain language)

1. **User picks/takes a photo.** Before anything is uploaded, the app reads the photo's hidden EXIF data (GPS coordinates + capture date) from the *original* file.
2. **If GPS is present,** the coordinates are sent to a small server endpoint that looks up the postcode (see below) and prefills the field. The user can always correct it.
3. **The app shrinks the image** to a sensible max dimension in the browser before upload — smaller files mean faster uploads on mobile and less storage. (EXIF is read in step 1 *first*, because shrinking re-saves the image and drops the hidden data.)
4. **The shrunk image is uploaded** to the user's private folder; on success the scan row is saved. Because the id and folder are fixed up front, a failed save never leaves a stray file to hunt down.

> **HEIC note:** iPhone HEIC photos can't be reliably shrunk or previewed in non-Safari browsers. For v1 HEIC files are uploaded **as-is** and the preview shows a neutral placeholder where the browser can't render them. (Automatic HEIC→JPEG conversion is a possible later enhancement.)

### Postcode auto-fill (the one server-side piece)

A small **server endpoint** turns GPS coordinates into a postcode (reverse geocoding) using **Nominatim (OpenStreetMap)** — a free, open service consistent with the project's open-data approach.

- **Why server-side, not from the browser:** Nominatim's usage rules require an identifying app name and a low request rate; doing it server-side lets us control that, cache repeats, avoid browser cross-origin issues, and keep the integration **swappable** (PROJ-4 will add more Germany geo/soil/weather lookups behind the same kind of seam).
- **Germany guard:** if the looked-up location isn't in Germany, the prefill is discarded and the user types a German PLZ manually (matches the Germany-first scope).
- **Always a fallback:** no GPS, a failed lookup, or a timeout simply leaves the field empty for manual entry — it never blocks the scan.

### CRUD placement

Scan create / read / update / delete run **client-side through Supabase**, exactly like PROJ-2's profile writes — owner-only RLS on the `scans` table and the per-user storage policy already enforce the security, so no redundant API routes are built. The **only** new server route is the reverse-geocoding helper above. This keeps the backend surface minimal and consistent with how PROJ-2 was built.

### Dependencies to Install
- **`exifr`** — reads EXIF GPS + capture date from the chosen photo in the browser (lightweight; handles JPEG and HEIC metadata). The one genuinely new package.
- **No package for image shrinking** — done with the browser's built-in canvas.
- **No package for geocoding** — the server endpoint calls Nominatim with the built-in fetch.
- All required shadcn components and `react-hook-form` + `zod` are already installed.

### Notes for Implementation
- This feature needs **both** `/frontend` (scan list, scan form with photo picker + preview, scan detail, empty/edit/delete states) and `/backend` (the `scans` table migration + RLS following PROJ-1's pattern, and the reverse-geocoding endpoint).
- Reuse PROJ-1's `@/lib/supabase/{client,server}` and PROJ-2's signed-URL + fixed-path storage approach.
- The disabled "Generate plan" control is a placeholder only — PROJ-6 owns its behavior.

## Implementation Notes (Frontend)

**Screens & components built (all behind PROJ-2's auth gate; each page also self-guards via server-side `getUser()`):**
- `app/scans/page.tsx` (server) — "My spaces" list + empty state. Loads the user's scans, batch-signs thumbnails (`createSignedUrls`, no N+1), renders `components/scans/scan-card.tsx`. Tolerates the `scans` table not existing yet (defaults to an empty list → empty state shows), mirroring PROJ-2's tolerant profile read.
- `app/scans/new/page.tsx` (server) → `components/scans/scan-form.tsx` (client, create mode).
- `app/scans/[id]/page.tsx` (server) — scan detail: photo, fact list, **disabled "Generate plan" seam** for PROJ-6, Edit link, Delete. `notFound()` when the scan isn't the user's / doesn't exist (RLS-backed).
- `app/scans/[id]/edit/page.tsx` (server) → `ScanForm` in edit mode (prefilled; can replace photo).
- `components/scans/photo-picker.tsx` (client) — dashed dropzone; **Take photo** (`capture="environment"`) + **Library** inputs + desktop drag/drop; preview with replace; HEIC placeholder when the browser can't render it.
- `components/scans/scan-form.tsx` (client) — the capture pipeline: read EXIF → (GPS present) auto-fill postcode via `/api/geocode` → on save, downscale → upload → insert/update the `scans` row → redirect to detail. Per-field Zod validation.
- `components/scans/delete-scan-button.tsx` (client) — `AlertDialog` confirm → removes the photo file + the row.
- `app/page.tsx` — home now has a primary **"Scan a space"** CTA into `/scans`.
- `lib/scans.ts` — option sets, Zod schema, types, fixed storage-path helper, display helpers. `lib/image.ts` — `readPhotoExif` (via **`exifr`**) and `downscaleImage` (browser canvas, 1600px longest edge → JPEG; HEIC passed through untouched). EXIF is read **before** downscaling (re-encoding strips it).

**Decisions during build:**
- **Upload happens on Save, not on file-pick** — the file + EXIF are held in the form and only uploaded when the row is written, so an abandoned form never strands a file (tighter than uploading immediately). The scan id is generated client-side (`crypto.randomUUID()`) up front so the storage path and row id match.
- **Scan CRUD is client-side via RLS** (per the architecture decision), so the only backend route needed is the geocoder.
- Plain `<img>` (not `next/image`) for previews/thumbnails — avoids remote-domain config and handles `blob:` preview URLs cleanly (Avatar already renders an `<img>`).
- Upload progress is shown as a busy/spinner state — `supabase-js` v2 `upload()` exposes no progress events, so a real percentage bar isn't available.

**Pending the PROJ-3 backend step (the UI is wired to these contracts):**
- **`scans` table** following PROJ-1's RLS pattern — owner-only SELECT/INSERT/UPDATE/DELETE (`user_id = auth.uid()`), indexed on `user_id` + `created_at`. Columns the UI reads/writes: `id`, `user_id`, `name`, `photo_path`, `postcode`, `lat`, `lng`, `sun_exposure`, `surface`, `space_type`, `area_sqm`, `taken_at`, `created_at`, `updated_at`. Mirror the client checks server-side (5-digit `postcode`; enum checks for `sun_exposure`/`surface`/`space_type`; `area_sqm` integer 1–5000; `name` ≤ 60). **Until applied, the scans list shows the empty state and saving errors.**
- **`POST /api/geocode`** — auth-checked; body `{ lat, lng }` → `{ postcode: string | null }`; reverse-geocodes via Nominatim server-side and discards non-Germany results. Until built, the `fetch` fails silently and the user types the postcode (the designed fallback).
- Storage needs **no change** — photos use the existing private `photos` bucket; PROJ-1's per-user folder policy already covers the `{user_id}/scans/{scan_id}/photo` path.

**Verification:** `tsc --noEmit` clean · `next build` succeeds (`/scans`, `/scans/new`, `/scans/[id]`, `/scans/[id]/edit` + Proxy) · unit tests **26/26** (13 new in `scans.test.ts`: schema validation, photo validation incl. HEIC-by-extension + 10 MB cap, and display/path helpers).

## Implementation Notes (Backend)

**Database (`supabase/migrations/20260618130000_proj3_scans.sql`):**
- Creates `public.scans` (one row per scanned space) following PROJ-1's RLS convention exactly: RLS enabled; owner-only SELECT/INSERT/UPDATE/DELETE policies scoped `to authenticated` via `(select auth.uid()) = user_id`; FK to `auth.users` with `on delete cascade` (GDPR erasure inherits PROJ-1's storage-cleanup trigger for the photo files).
- Columns: `id` (uuid, client-supplied or `gen_random_uuid()`), `user_id`, `name` (≤60 check), `photo_path` (not null — enforces "photo required" at the DB), `postcode` (not null, `~ '^\d{5}$'`), `lat`/`lng` (nullable, for PROJ-4), `sun_exposure`/`surface`/`space_type` (enum checks matching the client option sets), `area_sqm` (int, 1–5000 check), `taken_at`, `created_at`, `updated_at`.
- Composite index `idx_scans_user_created (user_id, created_at desc)` serves the list query (own scans, newest first) and FK/cascade lookups.
- `set_updated_at` BEFORE UPDATE trigger keeps `updated_at` fresh. Plain (not SECURITY DEFINER) with `search_path = ''` pinned to stay advisor-clean.
- ✅ **Applied & verified (2026-06-18):** migration run via the Supabase SQL editor. Confirmed through MCP — `public.scans` present with RLS enabled, all column checks + FK to `auth.users`, the 4 owner-only policies, `idx_scans_user_created`, and the `trg_scans_set_updated_at` trigger. Security advisor: no new warnings (the lone WARN — leaked-password protection — is a passwordless-auth non-issue; Sproutly is magic-link only).
- ✅ **GRANT fix applied & verified (2026-06-18) — `supabase/migrations/20260618150000_proj3_grant_scans_privileges.sql`.** Like PROJ-2's `users` table (BUG-7), `public.scans` was created without table-level privileges for `authenticated`/`service_role` (Supabase default privileges didn't apply), so authenticated scan reads/writes failed at runtime with `42501 permission denied` regardless of RLS — surfaced by PROJ-2's two-account harness. Granted via the SQL editor; confirmed through MCP `has_table_privilege`: authenticated SELECT/INSERT/UPDATE/DELETE all `true`, `service_role` `true`, `anon` `false`. Convention going forward: every user-data table needs an explicit `GRANT ... TO authenticated`.

**Route built — `POST /api/geocode` (`route.ts`):**
- Auth-gated (401 if no session). Zod-validates `{ lat, lng }` (400 on bad/non-JSON body). Reverse-geocodes via **Nominatim (OSM)** server-side with an identifying `User-Agent`, `Accept-Language: de`, and a 4s abort timeout.
- **Germany guard:** non-DE results (or no valid 5-digit PLZ) return `{ postcode: null }`. Upstream failure/timeout returns `{ postcode: null }` (502) so the client always falls back to manual entry — never blocks the scan.
- No new env var or secret (Nominatim is keyless).

**Scan CRUD stays client-side** (per the architecture decision): the frontend reads/writes `public.scans` and the `photos` bucket directly through the browser client, with owner-only RLS + the per-user storage policy enforcing security. The geocoder is the only server route this feature needs — no `/api/scans` CRUD routes.

**Storage:** unchanged — scan photos reuse PROJ-1's private `photos` bucket; its `(storage.foldername(name))[1] = auth.uid()` policy already covers `{user_id}/scans/{scan_id}/photo`.

**Verification:** `tsc --noEmit` clean · `next build` succeeds (`/api/geocode` + all scan routes + Proxy) · tests **49/49** (7 new in `geocode/route.test.ts`: 401 unauth, 400 invalid/non-JSON body, DE happy path, non-DE discard, no-PLZ null, upstream-failure fallback). Live-DB RLS/storage behaviour to be exercised in `/qa`.

## QA Test Results

**QA date:** 2026-06-18 · **Tester:** QA Engineer (`/qa`) · **Branch:** `proj-3-spec` (rebased on PROJ-2-complete `main`) · **Verdict:** ✅ **PRODUCTION-READY** — no Critical/High bugs.

### Environment / setup
- ✅ `public.scans` live with RLS + the 4 owner-only policies; **table-level GRANTs applied & verified** (`has_table_privilege`: authenticated SELECT/INSERT/UPDATE/DELETE true, `anon` false). This was the BUG-7-class gap, fixed before QA.
- ✅ Reuses PROJ-1's private `photos` bucket (per-user folder policy covers `{user_id}/scans/...`). Supabase security advisor: no new warnings.

### Test coverage
- **Unit/integration (Vitest): 54/54** — incl. `scans.test.ts` (13: schema validation, photo validation incl. HEIC-by-extension + 10 MB cap, display/path helpers) and `geocode/route.test.ts` (7: 401 unauth, 400 invalid/non-JSON body, DE happy path, non-DE discard, no-PLZ null, upstream-failure fallback).
- **E2E (Playwright): 13** PROJ-3 tests (31 suite-wide, all green) — route protection on **Chromium + Mobile Safari (390px)** (`PROJ-3-scan-routes.spec.ts`, 3×2) + the **two-account scans isolation harness** (`PROJ-3-scans-rls-isolation.spec.ts`, 7, browser-less `rls` project).
- `tsc` clean · `npm run lint` clean · `next build` green (11 routes + Proxy).

### Acceptance criteria
Legend: ✅ verified (automated) · 🟡 code/data-layer verified, **full UI not browser-exercised** (authenticated scan UI needs a real session) · ⚠️ caveat.

**Security (carries PROJ-1 RLS/storage) — ✅ proven against two real accounts (harness):**
- ✅ A can list/view/edit/delete only A's own scans, never B's *(cross-user read/update/delete all denied; A cannot insert a row owned by B — RLS `with_check`)*.
- ✅ Scan photo lives under `{user_id}/scans/...` and is not accessible to others *(cross-namespace upload + download denied)*.
- ✅ Unauthenticated visit to `/scans`, `/scans/new`, `/scans/{id}` → redirect to `/login?returnTo=…` *(E2E, both browsers)*.

**Validation — ✅ unit-tested + DB CHECK defense-in-depth:**
- ✅ Disallowed type / >10 MB rejected; HEIC accepted (incl. empty-type-by-extension). ✅ Missing photo blocks save (form logic).
- ✅ Non-5-digit postcode, unselected sun/surface/space-type, out-of-range/non-integer area, over-long name → validation error, nothing saved. Mirrored by table CHECKs (`postcode ~ '^\d{5}$'`, enums, `area_sqm` 1–5000, `name` ≤60).

**Creating / geocode / listing / editing / deleting — 🟡 code + data-layer verified, full UI flow not browser-exercised:**
- 🟡 Save → scan stored → detail view with "Space saved" + disabled "Generate plan" seam *(data-layer insert/read proven by harness; form orchestration — downscale→upload→insert→redirect — is code-reviewed + its pieces unit-tested)*.
- 🟡 Camera / library / drag-drop; preview + retake/replace *(component code-verified; not driven in a browser)*.
- 🟡 EXIF GPS → reverse-geocode prefill (editable); no-GPS/failed-lookup → manual, no block *(geocode route fully unit-tested incl. DE/non-DE/failure; client wiring code-verified)*.
- 🟡 My Spaces list (thumbnail + summary) / detail / edit (incl. replace photo) / empty state *(server components + signed URLs code-verified; own-row update + delete + photo removal proven at data layer by harness)*.
- 🟡 Delete confirm dialog → removes row + photo; cancel → nothing *(AlertDialog code-verified; the row+storage delete proven by harness)*.

### Security audit (red team)
- ✅ **Authorization:** scans owner-only RLS + storage folder policy — cross-user denial proven against two accounts; `with_check` blocks creating rows owned by another user.
- ✅ **Geocode SSRF:** the Nominatim URL is fixed-host with `lat`/`lng` interpolated; both are Zod-validated numbers with range bounds (NaN/Infinity fail `min`/`max`), so no path/host injection. Auth-gated (401 without session).
- ✅ **Injection/XSS:** Supabase parameterizes queries; scan fields render as escaped React text; no SVG in accepted photo types. DB CHECKs constrain even a crafted direct PostgREST write.
- ✅ **Storage path manipulation:** upload path's first segment must equal `auth.uid()` (policy) — proven denied for a cross-user path.
- ✅ **Secrets:** geocode uses no secret (Nominatim is keyless); service-role key not referenced in PROJ-3 client/route code.
- No Critical/High/Medium findings.

### Bugs found
None blocking. Informational / Low (carried or by-design, non-blocking):
- **INFO-1 (Low):** `POST /api/geocode` has no rate limiting — an authenticated user could spam it and get the app's IP throttled by Nominatim's public instance. Mitigated by auth-gating; tracked in Open Questions ("Nominatim at scale"). Add a per-user throttle (or self-host) before scale.
- **INFO-2 (Low):** photo type/size validation is client-side only (bypassable via a direct Storage call); mitigated by the private, per-user-namespaced bucket, owner-only signed URLs, and SVG exclusion. Same posture as PROJ-2's avatar; consider per-bucket MIME/size limits in PROJ-1 Storage config for defense-in-depth.
- **INFO-3 (by-design):** photo uploaded but DB insert fails → one orphaned object at the fixed `{user_id}/scans/{scan_id}/photo` path (overwritten on retry; bounded — no pile-up). Documented edge case.

### Residual risk (close before / at `/deploy`)
The **authenticated scan UI happy-path is not exercised by an automated browser test** (create/edit/delete via the form, camera/library capture, EXIF→geocode prefill) — it needs a real signed-in session. The security-critical paths and all validation are proven (two-account harness + unit tests); the data layer is confirmed reachable. **Recommended:** a manual two-account browser smoke (now possible with SMTP) — sign in, create a scan from a phone photo (verify EXIF postcode prefill), edit, delete; optionally a future seeded-session browser test to automate it.

### Production-ready decision
✅ **READY.** No Critical/High bugs. Scan data-layer security (owner-only RLS, storage isolation, grant) is proven end-to-end against two real accounts; validation is unit-tested with DB-level defense; route protection is browser-verified. The Low/INFO items are non-blocking; the manual UI smoke is the recommended pre-deploy step. **Status → Approved.**

## Deployment
_To be added by /deploy_

## Post-Deploy Enhancement — Short URL code (2026-06-23)

Production scan URLs (`/scans/<uuid>/plan`, `/shopping-list`, `/edit`) used the 36-char scan UUID. Added a short, URL-facing identifier so the journey shows clean links (`/scans/Kp3xR9aQ/plan`). The UUID remains the primary key for every internal reference (FKs, storage paths, RLS) — only the URL-facing identifier changed.

- **DB:** migration `20260623100000_proj3_scan_short_code.sql` adds `scans.short_code` (`text`, unique, not null), an 8-char code from an unambiguous alphabet (no `0/O/1/l/I`), auto-generated by a `before insert` trigger (`trg_scans_set_short_code`) and backfilled for existing rows. Helper/trigger functions have `EXECUTE` revoked from `anon/authenticated` (PROJ-1 convention).
- **App:** all four scan routes now resolve a scan by `short_code` and use `scan.id` for downstream queries; every `/scans/...` link emits `scan.short_code`; the new-scan insert returns `short_code` to navigate to it.
- **Security:** unchanged — pages are auth-gated and RLS is owner-only, so the short code is not a security token. The migration touches no RLS policy.
- **Tradeoff (chosen "Replace"):** old UUID-based bookmarks now 404. If preserving them matters, add a UUID-detection fallback in the scan page that redirects to the canonical short-code URL.
- **Status:** code complete, typecheck + lint + 159 unit tests green. **Migration not yet applied to production** — apply `20260623100000_proj3_scan_short_code.sql` (Supabase push) before/with the next deploy.

## Post-Deploy Enhancement — Optional photo (2026-06-24)

The photo was mandatory at three layers (DB `NOT NULL`, form validation, the "save without a photo blocks" acceptance criterion). It is now **optional** so a user — especially Maya, the Guilty Non-Starter — can create a scan from the conditions questions alone, without finding/taking a photo. The other fields (postcode, sun, surface, space type, area) stay **required**: they're the signal PROJ-4 enrichment and PROJ-6 plan generation run on. The photo is only a visual reference in v1 (AI vision is a deferred non-goal), so the journey never depended on it.

- **DB:** migration `20260624100000_proj3_photo_optional.sql` drops `NOT NULL` on `scans.photo_path`. No RLS / policy / storage change — a null path just means no object at `{user_id}/scans/{scan_id}/photo`.
- **App (no schema-type change needed — `Scan.photo_path` was already `string | null`):**
  - `scan-form.tsx` — removed the "Add a photo of your space" save-block; the photo label now reads "Photo (optional)" with a helper line ("No photo handy? You can skip this…"). Upload still only runs when a file is present.
  - `photo-picker.tsx` — empty-state copy changed to "Add a photo of your space (optional)".
  - **Remove photo (edit):** `PhotoPicker` gained a "Remove photo" button (shown whenever an image is present) and an `onRemove` callback. On save, removing a saved photo deletes the storage object (`storage.remove`, mirroring the delete-scan button), sets `photo_path = null`, and clears the photo-derived `lat`/`lng`/`taken_at`. Picking a new photo overrides a pending removal. In create mode the button just clears a fresh pick.
  - `scans/[id]/page.tsx` — the no-photo detail view now shows a neutral `ImageOff` "No photo added" placeholder instead of a blank box. The "My Spaces" list (`scan-card.tsx`) and its batch thumbnail signing already tolerated null paths (icon placeholder) — no change needed.
- **Security:** unchanged — pages stay auth-gated, RLS stays owner-only; the migration touches no policy. Client-side photo type/size validation still applies when a photo *is* provided.
- **Status:** code complete, `tsc` + `npm run lint` clean, `scans.test.ts` 13/13 green. **Migration not yet applied to production** — apply `20260624100000_proj3_photo_optional.sql` (Supabase dashboard SQL Editor) before/with the next deploy. Until applied, saving without a photo will fail the DB `NOT NULL` constraint at runtime.
