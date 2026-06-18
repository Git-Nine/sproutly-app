-- PROJ-3: Photo Upload & Space Scan — the scans table.
-- Deferred to this feature by PROJ-1 (which created only public.users). Follows the
-- PROJ-1 RLS convention exactly: RLS on, owner-only via (select auth.uid()), policies
-- scoped TO authenticated, FK to auth.users with ON DELETE CASCADE (GDPR erasure).
-- Photos live in PROJ-1's existing private `photos` bucket at {user_id}/scans/{scan_id}/photo;
-- that bucket's per-user folder policy already covers the path, so no storage change here.

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text check (name is null or char_length(name) <= 60),
  photo_path text not null,
  postcode text not null check (postcode ~ '^\d{5}$'),
  lat double precision,
  lng double precision,
  sun_exposure text not null check (sun_exposure in ('full', 'partial', 'shade')),
  surface text not null check (surface in ('gravel', 'lawn', 'soil', 'paved', 'mixed')),
  space_type text not null check (space_type in ('front_garden', 'back_garden', 'balcony', 'bed')),
  area_sqm integer not null check (area_sqm between 1 and 5000),
  taken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.scans is
  'PROJ-3: one row per scanned outdoor space. Manual capture now; AI vision later populates the same fields. lat/lng/postcode feed PROJ-4 enrichment.';

alter table public.scans enable row level security;

-- Owner-only access (the PROJ-1 pattern). A user may only ever touch their own scans.
create policy "Users can view own scans"
  on public.scans for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own scans"
  on public.scans for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update own scans"
  on public.scans for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own scans"
  on public.scans for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Serves the list query (own scans, newest first) and FK/cascade lookups by user_id.
create index idx_scans_user_created on public.scans (user_id, created_at desc);

-- Keep updated_at fresh on every edit (the UI reads it). Plain trigger, not SECURITY
-- DEFINER; search_path pinned to satisfy the function-search-path advisor lint.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_scans_set_updated_at
  before update on public.scans
  for each row execute function public.set_updated_at();
