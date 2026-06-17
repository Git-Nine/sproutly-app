-- PROJ-1: lock down trigger functions.
-- These are SECURITY DEFINER trigger functions and must NOT be callable directly
-- via the REST API (/rest/v1/rpc/...). Triggers still fire — they run as the
-- function owner regardless of EXECUTE grants — so revoking EXECUTE is safe and
-- closes the security advisor warnings (0028 / 0029).

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;
revoke execute on function public.handle_user_deletion() from public, anon, authenticated;
