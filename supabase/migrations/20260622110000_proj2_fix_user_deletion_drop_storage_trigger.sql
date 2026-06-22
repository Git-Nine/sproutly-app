-- PROJ-2 FIX (post-deploy bug): user / account deletion was fully broken in production.
--
-- PROJ-1's `on_auth_user_deleted` trigger (handle_user_deletion) direct-deletes from
-- storage.objects to clear a user's photos. Supabase has since added a
-- `storage.protect_delete()` guard that forbids direct deletes on storage tables
-- ("Direct deletion from storage tables is not allowed. Use the Storage API instead.").
-- So the trigger now RAISES on every user deletion → `delete from auth.users` aborts →
-- /api/account/delete returns 500 and GDPR erasure is impossible. (It also silently
-- broke the QA RLS harnesses' test-user cleanup, which is how this surfaced.)
--
-- Fix: drop the trigger + its unusable function. Photo cleanup now happens in
-- /api/account/delete via the Storage API (service role) BEFORE the user is deleted.
-- The public.users / scans / plans rows still cascade via their FK ON DELETE CASCADE
-- (that never depended on this trigger).

drop trigger if exists on_auth_user_deleted on auth.users;
drop function if exists public.handle_user_deletion();
