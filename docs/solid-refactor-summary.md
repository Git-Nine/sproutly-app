# SOLID Refactor — Summary of Changes

**Date:** 2026-07-03 · **Shipped:** PR [#10](https://github.com/Git-Nine/sproutly-app/pull/10), squash-merged to `main` as `83149f6`
**Result:** behavior-preserving, no DB change · test suite **194 → 241 green** · `tsc`, `eslint`, `next build` clean

This document summarises the full-codebase SOLID review (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion) and the six recommendations that were then implemented.

---

## The review in one paragraph

Sproutly was already a well-factored functional-core / imperative-shell codebase: the plan engine is pure and I/O-free, `Pick<>` types keep contracts narrow (ISP), and there was no speculative abstraction anywhere. The real weaknesses clustered in two places: **a handful of files that had accumulated too many responsibilities** (`scan-form.tsx` at 689 lines, `/api/enrich` at 330), and **duplication that let parallel copies of the same rule silently drift apart** (three definitions of the soil vocabulary, two hand-rolled Nominatim clients, two implementations of the quantity-cap maths). LSP had no findings — there is no inheritance to violate.

---

## 1. Decompose `scan-form.tsx` (SRP)

**Problem.** One 689-line component ran at least six concerns with 17 `useState` hooks: the 3-step wizard state machine, photo/EXIF lifecycle, Storage upload with dedup, the AI-vision prefill fetch, geolocation + reverse geocoding, hand-rolled Zod validation, insert-vs-update persistence, and the fire-and-forget enrichment trigger. The save rules (upload reuse, geo-clearing on photo removal) were effectively untestable without mocking both Supabase and `fetch`.

**Change.** All I/O moved out; the component now owns only wizard state, form fields, and the review-screen JSX (689 → 434 lines).

| New file | Responsibility |
|---|---|
| `src/lib/scans-client.ts` | `geocodeToPostcode`, `classifyScanPhoto`, `uploadScanPhoto`, `saveScan`, `deleteScan`, `shouldTriggerEnrichment`, `triggerEnrichment` |
| `src/hooks/use-vision-prefill.ts` | upload + classify + "already uploaded this exact file" dedup ref |
| `src/hooks/use-locate-postcode.ts` | geolocation → postcode with toast fallbacks |
| `src/components/scans/scan-wizard-steps.tsx` | `UploadStep`, `ReadingStep`, shared `PhotoFrame` |
| `src/components/scans/scan-field-row.tsx` | the design-system `FieldRow` + inline-control styles |

**Example.** The 120-line `handleSave` shrank to orchestration:

```tsx
// before (inside the component): upload dedup, branching insert/update,
// geo rules, enrichment trigger — ~90 lines of inline Supabase calls

// after:
const shortCode = await saveScan(supabase, {
  scanId, userId, existing: scan, values: parsed.data,
  photo: { file, alreadyUploadedPath: prefill.uploadedPathFor(file), remove: removePhoto },
  exif,
})
if (shouldTriggerEnrichment(scan, postcode, file !== null)) triggerEnrichment(scanId)
```

The previously untestable rules now have direct unit tests (`scans-client.test.ts`), e.g. *"updates an existing scan and refreshes geo from a new photo"* and *"reuses the AI-prefill upload instead of uploading again"*.

---

## 2. Slim `/api/enrich` to auth + validate + dispatch (SRP, DIP)

**Problem.** The 330-line route file contained six responsibilities: HTTP handling, background orchestration, DWD climate assembly, a hand-rolled Nominatim geocoder, domain logic (`deriveHardinessZone`, `isInGermany`), and persistence. The `export … for testing` comment was the tell — logic that must be exported from a route to be testable belongs in `src/lib/`. The geocoder was also duplicated: `/api/geocode` had its own copy with a *different* timeout (4 s vs 5 s) for no stated reason, so Nominatim's usage policy (identifying User-Agent, low rate) had to be enforced in two places.

**Change.** The route dropped to 84 lines (auth → validate → ownership check → pending write → `after(runEnrichment)`), and the logic moved to focused modules:

- `src/lib/enrichment/run.ts` — orchestration (coordinate resolution, Germany check, parallel BGR/DWD, stale guard)
- `src/lib/enrichment/climate.ts` — DWD grid URLs/scales + hardiness-zone derivation
- `src/lib/enrichment/store.ts` — the upsert + stale-result guard
- `src/lib/nominatim.ts` — **the single** Nominatim client (`forwardGeocodePostcode`, `reverseGeocodeToPostcode`); `/api/geocode` shrank to 39 lines

**Why it matters for testing:** the enrichment tests moved to a co-located `run.test.ts` and mock the geocoder at the module boundary (`vi.mock('@/lib/nominatim')`) instead of stubbing global `fetch` and hand-crafting Nominatim wire formats. Swapping the geo provider is now one file.

---

## 3. `requireUser()` / `parseJson()` route guards (SRP + security)

**Problem.** The `createClient → getUser → 401` block and the try/`safeParse`/400 block were copy-pasted across all four API routes. This duplication is *load-bearing*: the session middleware deliberately exempts `/api/*` from redirect gating, so every route must self-check auth — one forgotten paste in a future route is a security hole, not a style nit.

**Change.** New `src/lib/api.ts`, adopted by all four routes:

```ts
export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response          // 401, consistent shape

  const body = await parseJson(request, bodySchema)
  if (body.response) return body.response          // 400, first Zod issue message

  const { scan_id } = body.data
  // … actual route logic
}
```

Both helpers return a discriminated result (`{ user, supabase, response: null } | { response: NextResponse }`), so TypeScript narrows after the early return. A new route now gets correct auth in one line instead of eight.

---

## 4. One soil vocabulary + Zod enums derived from option arrays (OCP)

**Problem.** The five-bucket soil vocabulary was defined **three times** (`plants.ts` `SOIL_OPTIONS`, an inline union in `scans.ts`, `bgr.ts` `SoilType`) — the engine's type-compatibility worked only because the string unions happened to coincide. Separately, every Zod schema re-hardcoded enum literals the option arrays already defined. The concrete failure mode: add a surface to `SURFACE_OPTIONS` → the UI select shows it, but `scanSchema` silently rejects it at submit, and the compiler can't catch it.

**Change.**

- New dependency-free `src/lib/soil.ts` is the single source; `plants.ts` re-exports it (existing importers untouched), `scans.ts` and `bgr.ts` import the shared `Soil` type.
- New `optionValues()` in `src/lib/utils.ts`; every schema derives its enum from the same array that drives the UI:

```ts
// before — two copies of one vocabulary, only one visible to the compiler:
export const SURFACE_OPTIONS = [{ value: 'gravel', … }, …] as const
surface: z.enum(['gravel', 'lawn', 'soil', 'paved', 'mixed'], { message: '…' }),

// after — one edit point per vocabulary:
surface: z.enum(optionValues(SURFACE_OPTIONS), { message: 'Choose the current surface' }),
```

Applied to `scanSchema`, `plantSchema`, `profileSchema`, and the classify-vision route (which had grown its own private copy of this exact helper — now deleted). Bonus from the same finding: `MaintenanceLevel`/`ExperienceLevel` types and a `USERS_TABLE` constant now live in `profile.ts`, replacing hardcoded unions and stray `'users'` string literals.

---

## 5. Deduplicate the plan-engine quantity/cap maths (OCP/DRY)

**Problem.** PROJ-7's `computeQuantities` (interactive rebalance) reimplemented `applyCap` line-for-line, and the per-plant quantity and layer-area formulas each existed twice. The docstring *promised* "the same per-layer footprint maths as generation", but that invariant was maintained only by hand — a change to the density rule in one path would silently diverge the other, and the guardrail tests don't cover quantities.

**Change.** Four shared private helpers in `plan-engine.ts`, used by both `generatePlan` and `computeQuantities`:

```ts
densityFor(surface)                       // paved/gravel → plant half as densely
layerAreaSqm(area, layer, presentLayers)  // weighted 60/30/10 area split
quantityFor(plant, perArea, density)      // fills the area at mature spread, ≥ 1
capQuantities(entries, cap)               // global cap; only `adjustable` entries shrink
```

The pinned/unpinned distinction became an `adjustable` flag — generation passes everything adjustable, the rebalance marks user-pinned lines fixed. The old `applyCap` and both inline formula copies were deleted. **Equivalence evidence:** scaling maths and the decrement-the-largest tie-break order were kept identical, and the full engine suite plus the 252-site guardrail matrix pass unchanged.

---

## 6. Complete the `*-client.ts` persistence pattern (DIP) + two ordering bug fixes

**Problem.** The codebase already owned the right seam — `plans-client.ts` takes the Supabase client as a parameter, is unit-testable, and is shared by two components — but eight components instead instantiated `createClient()` and embedded query shapes inline. Two of those inline blocks also had real ordering bugs.

**Change.**

- **New `src/lib/plants-client.ts`** — `savePlant` (insert/update, empty optionals → `null`), `deletePlantWithReassign` (the atomic RPC), `isUniqueViolation` so `plant-form.tsx` keeps its friendly duplicate-Latin-name message without inspecting raw error codes inline.
- **New `src/lib/profile-client.ts`** — `updateProfile`, `uploadAvatar`, `removeAvatar`. This also ended the **avatar dual-write**: previously both the uploader *and* the profile form wrote `users.avatar_path` (the form via an `onPathChange` callback that existed only to keep its copy from going stale). The uploader is now the sole owner; the form never touches the column and the callback is gone.
- **`plans-client.ts` gains `replacePlanLines`**, used by the plan editor. This fixes the worst latent bug found in the review — the non-atomic delete-then-insert:

```ts
// before (in plan-editor.tsx): DELETE all lines, then INSERT the new set.
// Failure mode: insert fails after the delete → the plan is silently EMPTY
// on the server while the UI still shows lines.

// after (in plans-client.ts): INSERT new rows first (client-side ids),
// then prune everything else:
await supabase.from(PLAN_PLANTS_TABLE).insert(rows)            // step 1
await supabase.from(PLAN_PLANTS_TABLE).delete()
  .eq('plan_id', planId).not('id', 'in', `(${ids.join(',')})`) // step 2
```

  A failed prune now leaves temporary *duplicates* — which the read path already collapses via `mergeDuplicateLines` — instead of an empty plan. A true transaction would need a Postgres function (`plan_plants` deliberately has no `(plan_id, plant_id)` uniqueness, so upsert was not an option), i.e. a migration; deferred since the data-loss failure mode is what mattered.

- **`scans-client.ts` gains `deleteScan`** with the second ordering fix: the **row is deleted first**, then the photo is removed best-effort. Previously the photo was destroyed *before* the row delete — if the row delete then failed, the scan survived but its photo was gone forever.

Each new module has co-located tests asserting the orderings that matter: insert-before-prune, row-before-photo, clear-row-before-drop-file, and that a failed first step never executes the destructive second step.

---

## What was deliberately *not* changed

- **`findConstraintViolations` still doesn't reuse `matchingSurvivors`** — that duplication is documented defense-in-depth (a regression in the selection pipeline can't hide behind the same code that produced the plan). Applying DRY there would damage the design.
- **No create/edit split of `ScanForm`** — a "consider" item with real behavioral risk; the SRP win was achievable without it.
- **No DB migration** — the true-transaction fix for `replacePlanLines` and any RLS changes need explicit approval per project rules.
- **Lower-priority findings left open:** `callClassifier` still lives in the classify-vision route; `conditions-summary.tsx`/`plan-builder.tsx` still fetch `/api/enrich` inline; `dwd-grid.ts`'s CRS heuristic; the `PlanEditor` prop-forwarding (ISP) case.

## One intentional behavior change

`/api/geocode`'s 400 body now uses the standard first-Zod-issue message instead of the bespoke `'Provide numeric lat and lng.'` — consistency across routes was the point of `parseJson`; its test asserts only the status code. The unified Nominatim timeout is 5 s (previously an unexplained 4 s/5 s split).

## Verification

- Every step landed green before the next began: **194 → 222** (recs 1–3) → **241** (recs 4–6) passing tests across 28 files.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build` clean after each round.
- CI (`build-test`) passed on PR #10 before the squash-merge; the Vercel preview deployed successfully.
- Tracking notes added to `features/INDEX.md` (two dated entries, 2026-07-03).
