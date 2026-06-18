# Supabase Setup (PROJ-1)

How to get the backend foundation running locally and apply the PROJ-1 migrations.

## 1. Environment variables

> **This section is the canonical list of every environment variable the app needs** — for local `.env.local` **and** for the hosting provider (Vercel) dashboard. (`.env.local.example` is the usual quick-copy template, but env files are permission-locked in the AI tooling here, so this doc is the authoritative reference. Mirror these keys into `.env.local.example` if/when you edit it directly.)

Create `.env.local` in the project root with:

```bash
# Public — safe to expose in the browser; inlined at build time (NEXT_PUBLIC_*).
NEXT_PUBLIC_SUPABASE_URL=https://kkdcehmubkhzxhrefzwp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_Q_MFUU880aIRz55MjkW6CA_qsbqKC3T

# Secret — SERVER-ONLY. Never prefix with NEXT_PUBLIC_, never commit a real value.
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

| Variable | Scope | Required | Used by |
|----------|-------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (browser) | ✅ | All Supabase clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (browser) | ✅ | Browser/server clients (RLS enforces access) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret (server-only)** | ✅ | `POST /api/account/delete` (admin client, `src/lib/supabase/admin.ts`) — deletes the auth user, triggering the PROJ-1 cascade |

- The two `NEXT_PUBLIC_*` keys are **public** (safe in the browser); RLS enforces per-user access.
- `SUPABASE_SERVICE_ROLE_KEY` **bypasses RLS** — it must stay server-side only. It is read solely by `src/lib/supabase/admin.ts` (the account-delete route). A browser import throws because the non-public var is `undefined` there.
- On **Vercel**: set all three under Project → Settings → Environment Variables. The `NEXT_PUBLIC_*` pair is inlined at build, so set them **before** the first build / redeploy after changing them.
- If a public variable is missing or malformed, the app fails fast at startup with a clear error (see `src/lib/supabase/env.ts`).

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
