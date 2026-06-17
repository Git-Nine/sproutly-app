# Supabase Setup (PROJ-1)

How to get the backend foundation running locally and apply the PROJ-1 migrations.

## 1. Environment variables

Create `.env.local` in the project root with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://kkdcehmubkhzxhrefzwp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_Q_MFUU880aIRz55MjkW6CA_qsbqKC3T
```

- These are **public** client keys (safe to expose to the browser); RLS enforces access.
- The **service-role** key is NOT used by the app and must never be committed or referenced from client-reachable code.
- If a variable is missing or malformed, the app fails fast at startup with a clear error (see `src/lib/supabase/env.ts`).

## 2. Apply the database migrations

The migrations live in `supabase/migrations/`:

| File | What it creates |
|------|-----------------|
| `…_proj1_users_profile_and_auth.sql` | `public.users` profile table, RLS policies, role-escalation guard, auto-provisioning trigger |
| `…_proj1_storage_photos_bucket.sql` | Private `photos` bucket, user-namespaced storage policies, GDPR deletion trigger |

Apply them either way:

**Option A — Supabase CLI (recommended):**
```bash
supabase link --project-ref kkdcehmubkhzxhrefzwp
supabase db push
```

**Option B — Dashboard:** paste each file's contents into the SQL Editor (in filename order) and run.

## 3. Enable magic-link auth

In the Supabase dashboard → **Authentication → Providers → Email**: ensure Email is enabled (it is by default). Magic links use this provider — no password needed. v1 uses Supabase's **built-in email service** (rate-limited; fine for dev/early beta).

## 4. Create the first admin (manual)

New users default to `role = 'user'`. To promote yourself after signing in once, run in the SQL Editor:

```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

Regular users cannot escalate their own role (blocked by the `prevent_role_self_escalation` trigger); only the dashboard/service-role context or an existing admin can change roles.

## 5. Using the clients in code

- **Client Components:** `import { createClient } from '@/lib/supabase/client'`
- **Server Components / Route Handlers / Server Actions:** `import { createClient } from '@/lib/supabase/server'` (async)
- Session refresh is handled automatically by `src/middleware.ts`.
