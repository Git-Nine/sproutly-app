-- PROJ-11: Plant Catalogue ETL (FloraWeb/BfN + open-data stack + AI trait mapping).
--
-- Additive, backward-compatible columns on public.plants for the bulk AI-assisted
-- import. The existing ~40 seeded rows and every current PROJ-5/PROJ-6 read keep
-- working unchanged: every column is nullable (or array-defaulted) and nothing is
-- backfilled. No RLS change — the table's PROJ-5 policies (all authenticated read,
-- admins write) already cover these columns.
--
-- Rationale (spec Decision Log, 2026-07-06): a bulk import stresses trade-offs a
-- hand-curated 40 never did — you can't tell an AI guess from a fact (provenance),
-- CC-licensed images legally need attribution, and dry-vs-wet shade is a real
-- survival distinction the soil buckets don't capture.

-- Water needs — a new survival-critical trait, separate from soil (Ellenberg F
-- buckets: dry / moist / wet). Populated by the import; null on the pre-existing rows.
-- Wiring it into PROJ-6's survival filter is an out-of-scope follow-on.
alter table public.plants add column if not exists moisture text
  check (moisture is null or moisture in ('dry', 'moist', 'wet'));

-- Image attribution + licence — CC / public-domain images need attribution to be
-- displayed compliantly. Stored alongside the existing image_url; surfaced where the
-- image renders (a display-side PROJ-6/PROJ-7 follow-on).
alter table public.plants add column if not exists image_attribution text
  check (image_attribution is null or char_length(image_attribution) <= 500);
alter table public.plants add column if not exists image_license text
  check (image_license is null or char_length(image_license) <= 100);

-- Row-level provenance — where this row came from (e.g. 'seed' for the hand-seeded
-- rows, 'open_data_etl' for this pipeline). Free text so future sources don't need a
-- migration; null on pre-existing rows (not backfilled, per the additive contract).
alter table public.plants add column if not exists source text
  check (source is null or char_length(source) <= 100);

-- Per-field AI-origin tracking — which survival-critical traits are still an AI guess
-- vs. human-corrected. Lets a curator target re-verification without re-checking
-- everything. Elements are constrained to the survival-critical field names; empty
-- array (or null) means "nothing is AI-origin" (the hand-seeded rows).
alter table public.plants add column if not exists ai_origin_fields text[]
  check (
    ai_origin_fields is null
    or ai_origin_fields <@ array['sun_tolerance', 'soil_compatibility', 'moisture', 'min_hardiness_zone']
  );

comment on column public.plants.moisture is
  'PROJ-11: water needs (dry/moist/wet, Ellenberg F). Populated by the import; consumed by a later PROJ-6 filter enhancement.';
comment on column public.plants.image_attribution is
  'PROJ-11: photo credit for CC-licensed images, surfaced where the image renders.';
comment on column public.plants.image_license is
  'PROJ-11: licence the photo is under (e.g. CC-BY-SA-4.0, Public domain).';
comment on column public.plants.source is
  'PROJ-11: row provenance (e.g. seed, open_data_etl). Distinguishes hand-curated from imported rows.';
comment on column public.plants.ai_origin_fields is
  'PROJ-11: survival-critical fields still AI-inferred (not human-corrected), for targeted re-verification.';
