-- PROJ-4: Environmental Data Enrichment — scan_enrichment table.
-- Stores environmental data derived from three open-data sources (BGR, DWD×3)
-- for each saved scan. One row per scan; cascade-deletes with the parent scan.
-- Follows the PROJ-1/PROJ-3 RLS convention: owner-only via (select auth.uid()).
-- The background enrichment API uses the service-role key to write this table
-- (post-response in an `after()` callback), so RLS policies cover reads and
-- user-initiated retries while the service role bypasses RLS for background writes.

create table public.scan_enrichment (
  id              uuid        primary key default gen_random_uuid(),
  scan_id         uuid        not null unique references public.scans (id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,

  -- Overall enrichment status
  status          text        not null default 'pending'
                              check (status in ('pending', 'complete', 'partial', 'failed')),
  requested_at    timestamptz not null default now(),

  -- Soil data (from BGR BÜK200 REST Identify)
  soil_type       text        check (soil_type in ('sand', 'loam', 'clay', 'silt', 'peat')),
  soil_status     text        not null default 'pending'
                              check (soil_status in ('pending', 'success', 'unavailable')),

  -- Climate normals data (from DWD CDC multi-annual grids, 1991–2020)
  rainfall_mm     integer,
  annual_min_temp numeric(5, 1),
  frost_days      integer,
  climate_status  text        not null default 'pending'
                              check (climate_status in ('pending', 'success', 'unavailable')),
  climate_period  text,       -- e.g. '1991–2020'

  -- Hardiness zone (derived from annual_min_temp — no third API)
  hardiness_zone  text,       -- e.g. '7'
  zone_status     text        not null default 'pending'
                              check (zone_status in ('pending', 'success', 'unavailable')),

  -- Metadata
  location_basis  text        check (location_basis in ('gps', 'postcode_centroid')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.scan_enrichment is
  'PROJ-4: environmental conditions derived per scan — soil (BGR), climate normals (DWD), hardiness zone (derived). One row per scan; cascade-deletes with the scan.';

-- Indexes: user_id for RLS queries; scan_id is already the unique constraint.
create index idx_scan_enrichment_user_id on public.scan_enrichment (user_id);

alter table public.scan_enrichment enable row level security;

-- Owner-only RLS — matches the scans table pattern exactly.
create policy "Users can view own scan enrichment"
  on public.scan_enrichment for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own scan enrichment"
  on public.scan_enrichment for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own scan enrichment"
  on public.scan_enrichment for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own scan enrichment"
  on public.scan_enrichment for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- set_updated_at() function was created in the PROJ-3 migration — reuse it here.
create trigger trg_scan_enrichment_set_updated_at
  before update on public.scan_enrichment
  for each row execute function public.set_updated_at();
