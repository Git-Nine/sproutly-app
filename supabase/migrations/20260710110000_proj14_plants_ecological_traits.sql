-- PROJ-14: Ecological Trait Enrichment (ETL extension).
--
-- Additive, backward-compatible ecological columns on public.plants that feed the
-- PROJ-15 Biodiversity Indicator. Every column is nullable and NOTHING is backfilled,
-- so the existing rows and every current PROJ-6/PROJ-13 read keep working unchanged.
-- No RLS change — the table's PROJ-5 policies (all authenticated read, admins write)
-- already cover these columns.
--
-- Two states must stay distinct downstream (PROJ-15 must NOT conflate them):
--   NULL          = not assessed
--   'none'/false  = assessed — genuinely no wildlife value (e.g. wind-pollinated grass)
-- The check constraints allow 'none' as a real value; the columns stay nullable so
-- "not assessed" remains representable.

-- Insect/pollinator value + bird/wildlife value — ordinal bands (none/low/medium/high),
-- matching the app's banded-honesty convention (PROJ-13). Bands, never raw counts.
alter table public.plants add column if not exists insect_value text
  check (insect_value is null or insect_value in ('none', 'low', 'medium', 'high'));
alter table public.plants add column if not exists bird_value text
  check (bird_value is null or bird_value in ('none', 'low', 'medium', 'high'));

-- Bloom period — two nullable months (1–12). A winter bloomer that wraps the year is
-- simply end < start (e.g. Nov=11 → Feb=2); no special storage needed — only PROJ-15's
-- coverage maths must expect the wrap. Both-or-neither is enforced below + in app code.
alter table public.plants add column if not exists bloom_start_month smallint
  check (bloom_start_month is null or bloom_start_month between 1 and 12);
alter table public.plants add column if not exists bloom_end_month smallint
  check (bloom_end_month is null or bloom_end_month between 1 and 12);

-- Pollinator-friendly flag. NULL = not assessed; distinct from false (assessed, not
-- pollinator-friendly).
alter table public.plants add column if not exists pollinator_friendly boolean;

-- Ecological provenance — which ecological traits are still an AI guess vs. human-
-- verified. Kept SEPARATE from ai_origin_fields (survival provenance) so the sync
-- backfill can push ecological provenance onto a live row WITHOUT clobbering a survival
-- verification a curator did earlier. The bloom pair is one entry ('bloom_period') —
-- the two months are inferred and verified together.
alter table public.plants add column if not exists eco_ai_origin_fields text[]
  check (
    eco_ai_origin_fields is null
    or eco_ai_origin_fields <@ array['insect_value', 'bird_value', 'bloom_period', 'pollinator_friendly']
  );

-- Belt-and-suspenders: the bloom pair is one fact stored in two columns — set both or
-- neither. Guarded so re-running this migration (dashboard SQL editor) is idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plants_bloom_pair_both_or_neither'
  ) then
    alter table public.plants add constraint plants_bloom_pair_both_or_neither
      check ((bloom_start_month is null) = (bloom_end_month is null));
  end if;
end $$;

comment on column public.plants.insect_value is
  'PROJ-14: insect/pollinator value band (none/low/medium/high). NULL = not assessed, ''none'' = assessed & genuinely no value. Feeds PROJ-15.';
comment on column public.plants.bird_value is
  'PROJ-14: bird/wildlife value band (none/low/medium/high). NULL = not assessed. Feeds PROJ-15.';
comment on column public.plants.bloom_start_month is
  'PROJ-14: bloom start month 1–12 (NULL = not assessed / non-flowering). May be > bloom_end_month for a year-wrapping winter bloomer.';
comment on column public.plants.bloom_end_month is
  'PROJ-14: bloom end month 1–12 (NULL = not assessed / non-flowering). May be < bloom_start_month (year wrap).';
comment on column public.plants.pollinator_friendly is
  'PROJ-14: pollinator-friendly flag. NULL = not assessed, distinct from false.';
comment on column public.plants.eco_ai_origin_fields is
  'PROJ-14: ecological traits still AI-inferred (not human-verified), for targeted re-verification. SEPARATE from ai_origin_fields so ecological & survival provenance stay independent.';
