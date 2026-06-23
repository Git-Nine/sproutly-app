-- PROJ-3: short, URL-facing identifier for scans.
-- The scan UUID is still the primary key (FKs, storage paths, RLS all unchanged),
-- but it makes for an ugly 36-char production URL (/scans/<uuid>/plan). This adds a
-- short opaque code used only in the URL. Pages resolve a scan by short_code, then
-- use the resolved row's UUID for every downstream query as before.
--
-- The URL is auth-gated and protected by RLS (owner-only SELECT), so the short code
-- is not a security token — it only needs to be unique and unguessable enough to
-- avoid casual collisions, not cryptographically secret.

-- Generator: 8 chars from an unambiguous alphabet (no 0/O/1/l/I). No uniqueness
-- guarantee on its own — callers loop against the unique index below.
-- Plain function (not SECURITY DEFINER); search_path pinned per the project lint.
create or replace function public.gen_scan_short_code()
returns text
language plpgsql
volatile
set search_path = ''
as $gen$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$gen$;

-- Returns text → would be exposed as a REST RPC (/rest/v1/rpc/gen_scan_short_code).
-- It is an internal helper only; revoke direct EXECUTE (the trigger below still runs
-- it, as triggers ignore EXECUTE grants). Matches the PROJ-1 trigger-fn lockdown.
revoke execute on function public.gen_scan_short_code() from public, anon, authenticated;

alter table public.scans add column if not exists short_code text;

-- Backfill existing rows with unique codes (one at a time so the uniqueness check
-- sees rows committed earlier in this loop).
do $backfill$
declare
  r record;
  candidate text;
begin
  for r in select id from public.scans where short_code is null loop
    loop
      candidate := public.gen_scan_short_code();
      exit when not exists (select 1 from public.scans where short_code = candidate);
    end loop;
    update public.scans set short_code = candidate where id = r.id;
  end loop;
end;
$backfill$;

alter table public.scans alter column short_code set not null;

-- Enforces uniqueness AND serves the `.eq('short_code', ...)` page lookups.
create unique index if not exists idx_scans_short_code on public.scans (short_code);

comment on column public.scans.short_code is
  'PROJ-3: short opaque code used in the URL (/scans/<short_code>). Auto-generated on insert; the uuid id remains the PK for all internal references.';

-- Auto-assign a unique code on insert when the client did not supply one.
create or replace function public.set_scan_short_code()
returns trigger
language plpgsql
volatile
set search_path = ''
as $settag$
declare
  candidate text;
begin
  if new.short_code is not null then
    return new;
  end if;
  loop
    candidate := public.gen_scan_short_code();
    exit when not exists (select 1 from public.scans where short_code = candidate);
  end loop;
  new.short_code := candidate;
  return new;
end;
$settag$;

revoke execute on function public.set_scan_short_code() from public, anon, authenticated;

drop trigger if exists trg_scans_set_short_code on public.scans;

create trigger trg_scans_set_short_code
  before insert on public.scans
  for each row execute function public.set_scan_short_code();
