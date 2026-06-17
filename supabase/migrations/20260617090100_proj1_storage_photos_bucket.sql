-- PROJ-1: private photo storage, user-namespaced (/{user_id}/...)
-- One private bucket shared by scan photos (PROJ-3) and progress photos (PROJ-9).

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- Storage RLS: a user may only access files under their own /{user_id}/ prefix.
-- (storage.foldername(name))[1] is the first path segment = the owner's user id.
create policy "Users can view own photos"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can upload own photos"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can update own photos"
  on storage.objects for update
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can delete own photos"
  on storage.objects for delete
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- GDPR erasure: when an auth user is deleted, remove their photo files.
-- (The public.users row is removed automatically via the FK cascade.)
create or replace function public.handle_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from storage.objects
  where bucket_id = 'photos'
    and (storage.foldername(name))[1] = old.id::text;
  return old;
end;
$$;

create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.handle_user_deletion();
