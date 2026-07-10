-- PROJ-13: Survival Confidence Band — two nullable snapshot columns, nothing else.
--
-- The band itself is COMPUTED, never persisted (recomputed from snapshot + current
-- catalogue on every render, so curator corrections improve existing plans' bands
-- automatically). These columns only give the calculation the two site facts the
-- plan snapshot doesn't already carry:
--
--   snapshot_rainfall_mm     — the site's annual rainfall (raw millimetres, DWD
--                              multi-annual grid) at generation time. Stored RAW;
--                              bucketing into low/medium/high happens at read time
--                              behind named constants (src/lib/plan-confidence.ts),
--                              so tuning thresholds never touches stored plans.
--   snapshot_location_basis  — whether the site location came from GPS or a
--                              postcode centroid (mirrors scan_enrichment.location_basis).
--
-- Both nullable: plans created before this feature have neither, and the
-- confidence module SKIPS factors whose data is missing — "never guess" falls
-- out of the schema. No backfill, no RLS change (plans is already owner-scoped,
-- 20260622100100_proj6_plans.sql).

alter table public.plans
  add column snapshot_rainfall_mm integer
    check (snapshot_rainfall_mm is null or snapshot_rainfall_mm between 0 and 10000);

comment on column public.plans.snapshot_rainfall_mm is
  'PROJ-13: site annual rainfall (raw mm, DWD) at generation time. NULL = climate enrichment unavailable or pre-PROJ-13 plan; the moisture band factor is then skipped.';

alter table public.plans
  add column snapshot_location_basis text
    check (snapshot_location_basis is null or snapshot_location_basis in ('gps', 'postcode_centroid'));

comment on column public.plans.snapshot_location_basis is
  'PROJ-13: how the site location was derived at generation time (gps | postcode_centroid). NULL = unknown or pre-PROJ-13 plan; the location band factor is then skipped.';
