-- PROJ-1: Supabase Infrastructure Setup — users profile foundation
-- The ONLY table PROJ-1 creates. Establishes the RLS pattern every later feature copies:
--   * RLS enabled, owner-only access via (select auth.uid())
--   * Policies for SELECT / INSERT / UPDATE / DELETE as appropriate

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  maintenance_preference text check (maintenance_preference in ('low', 'medium', 'high')),
  experience_level text check (experience_level in ('beginner', 'intermediate', 'expert')),
  created_at timestamptz not null default now()
);

comment on table public.users is
  'User profile, 1:1 with auth.users. PROJ-1 foundation. maintenance_preference and experience_level are populated by PROJ-2.';

alter table public.users enable row level security;

-- RLS: a user may only see and edit their OWN row (the owner-only pattern).
-- No DELETE policy: profiles are removed only via the auth.users cascade (GDPR erasure).
create policy "Users can view own profile"
  on public.users for select
  using ((select auth.uid()) = id);

create policy "Users can insert own profile"
  on public.users for insert
  with check ((select auth.uid()) = id);

create policy "Users can update own profile"
  on public.users for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Prevent privilege escalation: a regular user must not set role = 'admin' on their own row.
-- Role changes are allowed only from a privileged context (dashboard / service role, where
-- auth.uid() is null) or by an existing admin. For everyone else the old role is restored.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is not null and not exists (
      select 1 from public.users where id = auth.uid() and role = 'admin'
    ) then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_self_escalation
  before update on public.users
  for each row execute function public.prevent_role_self_escalation();

-- Auto-provision a profile row when a new auth user is created. Idempotent: a repeated
-- insert (race on first sign-in) does nothing rather than creating a duplicate.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
