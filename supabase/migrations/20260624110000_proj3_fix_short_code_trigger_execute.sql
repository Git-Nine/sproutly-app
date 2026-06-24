-- PROJ-3 FIX: "permission denied for function gen_scan_short_code" on every
-- authenticated scan insert.
--
-- Root cause: the BEFORE INSERT trigger function set_scan_short_code() was a plain
-- (SECURITY INVOKER) function that calls the helper gen_scan_short_code(). The
-- trigger itself fires fine (triggers ignore EXECUTE grants on the trigger fn), but
-- the *nested* call to gen_scan_short_code() runs with the invoking user's rights —
-- and EXECUTE on that helper is revoked from authenticated (so it isn't exposed as a
-- REST RPC). So the inner call was denied for every authenticated INSERT. It went
-- unnoticed because the backfill ran as the migration owner and only existing rows
-- were ever read back.
--
-- Fix: run the trigger function as SECURITY DEFINER so its nested helper call
-- executes as the function owner (which retains EXECUTE). The helper stays revoked
-- from anon/authenticated (no direct RPC). search_path stays pinned to '' and every
-- reference is schema-qualified, so SECURITY DEFINER is safe here. The function only
-- generates a random code and checks uniqueness — no dynamic SQL, no user input.

create or replace function public.set_scan_short_code()
returns trigger
language plpgsql
volatile
security definer
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

-- Keep it off the REST surface (CREATE OR REPLACE preserves grants; explicit + idempotent).
revoke execute on function public.set_scan_short_code() from public, anon, authenticated;
