# PROJ-1: Supabase Infrastructure Setup

## Status: In Progress
**Created:** 2026-06-17
**Last Updated:** 2026-06-17

## Dependencies
- None

## User Stories
- As a **developer**, I want a configured Supabase project with environment variables wired into the app, so that I can build every feature against a working backend.
- As a **developer**, I want a documented RLS convention and a foundational `users` table, so that every later feature enforces per-user data isolation the same way.
- As a **new user**, I want to authenticate via a magic link (no password), so that I can get started with minimal friction. _(Login UI is PROJ-2; PROJ-1 only enables the provider.)_
- As a **user**, I want my photos stored privately in my own namespace, so that no other user can ever access them.
- As the **operator**, I want to designate admin accounts, so that I can manage the plant database later (PROJ-5).

## Out of Scope
- Signup/login/profile **UI and flows** — PROJ-2 (PROJ-1 enables the provider and creates the table; PROJ-2 builds the screens)
- **Capturing** profile values (maintenance preference, experience level) via UI — PROJ-2 (the columns exist here, but are not populated through any UI)
- All **feature-specific tables** — `scans` (PROJ-3), `plants` + admin (PROJ-5), `plans`/`plan_plants` (PROJ-6/PROJ-7), `shopping_lists` (PROJ-8), `progress_logs` (PROJ-9). Each is created by its owning feature following PROJ-1's RLS pattern.
- **Admin / role-management UI** — admins are set manually via SQL for v1
- **External API** config and integration (BGR, DWD, hardiness zones) — PROJ-4
- **Plant data seeding** — PROJ-5
- **Next.js production hosting / deployment** — `/deploy`
- **Custom SMTP / branded magic-link emails** — uses Supabase's default email service for v1 (see Open Questions)
- **Social / OAuth providers** — deferred

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

- [ ] Given the Supabase environment variables are set, when the application starts, then the Supabase client connects successfully without errors.
- [ ] Given the Supabase environment variables are missing or invalid, when the application starts, then startup fails with a clear error message (fail fast) rather than a silent null client.
- [ ] Given a new user authenticates for the first time, when authentication succeeds, then a corresponding record is automatically created in the `users` table with `role = 'user'`.
- [ ] Given magic link is enabled as the auth method, when a sign-in is requested with a valid email address, then Supabase sends a magic-link email to that address.
- [ ] Given RLS is active on the `users` table, when a logged-in user queries data, then they receive only their own record (`user_id = auth.uid()`).
- [ ] Given a logged-in user attempts to read or modify another user's record, when the request executes, then it is denied by RLS.
- [ ] Given a private, user-namespaced storage bucket is configured, when a user uploads a file into their own folder (`/{user_id}/...`), then the upload succeeds.
- [ ] Given a user is logged in, when they attempt to access a file in another user's folder, then access is denied by the storage policy.
- [ ] Given a new user is created, when no role is explicitly set, then the default value is `role = 'user'`.
- [ ] Given a `users` record has `role = 'admin'` (set manually), when the role is queried, then `'admin'` is returned and is available for later admin gates.

## Edge Cases
- **Missing/invalid env vars** — the app fails fast with a clear message, not a silent null client.
- **Repeated first-login / race condition** — profile-row auto-creation must be idempotent (no duplicate `users` rows).
- **Auth user deletion** — what happens to their `users` row and stored files? (cascade / GDPR erasure — see Open Questions).
- **Storage path manipulation** — a user crafting a path outside `/{their_id}/` is denied by the storage policy.
- **Expired or reused magic-link token** — rejected; the user must request a new link.
- **Magic-link email not delivered / rate-limited** — Supabase's default email service has rate limits (UI messaging is handled in PROJ-2, but the limit exists at this layer).

## Technical Requirements (optional)
- **Security:** RLS enabled on every user-data table (PROJ-1 sets the pattern and applies it to `users`); private storage buckets; secrets only in environment variables, never committed.
- All user-data tables follow the `user_id = auth.uid()` ownership rule.
- Auth session handling wired for both server and client (App Router) plus middleware for protected routes.

## Open Questions
- [x] Magic-link email: stick with Supabase's built-in email service for v1, or configure custom SMTP? → **Resolved (/architecture):** built-in service for v1; revisit before scaling (rate limits apply).
- [x] On auth-user deletion, should the `users` row **and** the user's storage files cascade-delete (GDPR right-to-erasure)? → **Resolved (/architecture):** yes — cascade delete everything.
- [x] Single hosted Supabase project for v1 (no separate staging environment)? → **Resolved (/architecture):** yes — single EU-region project for v1.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Foundation-only schema (not all 7 tables) | Single Responsibility — later features own their tables; avoids speccing tables blind | 2026-06-17 |
| Magic-link (passwordless) auth | Low friction, no password management, fits the calm tone | 2026-06-17 |
| Admins assigned manually via SQL; default `role = 'user'` | Lowest-effort, safe approach for single-operator v1; no admin-role UI in scope | 2026-06-17 |
| Single private storage bucket, user-namespaced (`/{user_id}/...`) for all photos | Simplest model satisfying the isolation requirement; scan and progress photos share it | 2026-06-17 |
| Profile columns (maintenance preference, experience level, role) created in PROJ-1 | Schema foundation belongs here; value-capture UI deferred to PROJ-2 | 2026-06-17 |

### Technical Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| `@supabase/ssr` for the connection layer | Official, current way to handle auth sessions across server components, browser, and middleware in Next.js App Router; replaces the deprecated auth-helpers | 2026-06-17 |
| Single hosted Supabase project, **EU region** | German users + GDPR — keep data in the EU; no separate staging environment for v1 | 2026-06-17 |
| Magic-link auth with Supabase **built-in email** for v1 | Passwordless, zero email setup; built-in send rate is sufficient for dev/early beta, revisit before scale | 2026-06-17 |
| Single **private** storage bucket, user-namespaced (`/{user_id}/...`) | Simplest design that fully isolates each user's photos; shared by scan (PROJ-3) and progress (PROJ-9) images | 2026-06-17 |
| Auto-create `users` profile row on first sign-in (idempotent) | Guarantees the profile always exists for later features; safe against duplicate creation on repeated sign-in | 2026-06-17 |
| Cascade delete on account removal (profile row + storage files) | Clean GDPR right-to-erasure; nothing orphaned | 2026-06-17 |
| Validate Supabase env vars at startup (fail fast) | Clear, immediate error if keys are missing/invalid instead of a silent null client failing later | 2026-06-17 |
| Service-role key kept server-only; only URL + anon key are public | Prevents privilege escalation from the browser; standard Supabase security boundary | 2026-06-17 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Building Blocks
PROJ-1 has **no user-facing screens** (login UI is PROJ-2). It is the foundation everything else stands on:

```
Supabase Project (single, EU region)
├── Environment Config
│   ├── Public keys (URL + anon key) — safe in the browser
│   └── Service-role key — server-only, never shipped to the browser
├── Connection Layer (how the app talks to Supabase)
│   ├── Browser client   → for components running in the user's browser
│   ├── Server client    → for server-rendered pages & server actions
│   └── Middleware       → keeps the login session fresh, guards protected routes
├── Authentication
│   └── Magic-link (passwordless email) — built-in email service for v1
├── Database
│   └── users (profile) table  ← the only table PROJ-1 creates
│       └── RLS convention      ← the security pattern every later feature copies
├── Auto-provisioning
│   └── On first sign-in → a profile row is created automatically (safely, no duplicates)
├── Storage
│   └── One private bucket, each user locked to their own /{user_id}/ folder
└── Account Deletion
    └── Deleting a user removes their profile row AND all their photos (GDPR erasure)
```

### Data Model (plain language)
**`users` (profile)** — one row per account:
- **ID** — matches the Supabase auth user (links login to profile)
- **Email**
- **Role** — `user` or `admin`, defaults to `user` (admin set manually via the dashboard)
- **Maintenance preference** & **Experience level** — columns exist now, populated later by PROJ-2's profile UI
- **Created timestamp**

Access rule (RLS): a logged-in person can only see and edit **their own** profile row. The `role` value is what later admin features (PROJ-5) check.

**Storage** — one **private** bucket. Every file lives under a folder named after the owner's user ID; the access policy only ever lets a person touch files inside their own folder. Scan photos (PROJ-3) and progress photos (PROJ-9) both live here.

### Tech Decisions (summary)
See the Technical Decisions table above for the full list with rationale. Key points: `@supabase/ssr` for session handling, EU-region single project, magic-link + built-in email, single private user-namespaced bucket, idempotent profile auto-provisioning, cascade delete on account removal, fail-fast env validation, service-role key server-only.

### Dependencies to Install
- **`@supabase/ssr`** — session handling for the App Router (the one genuinely new package)
- **`supabase` CLI** (dev only) — to manage the database migration locally
- _(`@supabase/supabase-js` and `zod` are already installed.)_

### Notes for Implementation (/backend)
- This feature is **backend-only** — run `/backend` next, not `/frontend` (no UI to build in PROJ-1).
- The RLS pattern established here (`user_id = auth.uid()`, policies for SELECT/INSERT/UPDATE/DELETE) is the template every subsequent feature's tables must follow.

## Implementation Notes (Backend)

**Built:**
- **Migrations** (`supabase/migrations/`):
  - `…_proj1_users_profile_and_auth.sql` — `public.users` profile table (FK to `auth.users` with `ON DELETE CASCADE`), RLS owner-only policies (SELECT/INSERT/UPDATE; no DELETE), `prevent_role_self_escalation` trigger, and idempotent `handle_new_user` auto-provisioning trigger.
  - `…_proj1_storage_photos_bucket.sql` — private `photos` bucket, user-namespaced storage policies (`/{user_id}/...`), and `handle_user_deletion` trigger that removes a user's files on account deletion (GDPR erasure).
  - `…_proj1_revoke_trigger_fn_execute.sql` — revokes `EXECUTE` on the three trigger functions from `public`/`anon`/`authenticated` so they can't be called directly via the REST API (triggers still fire as the owner). Added in response to security-advisor lints 0028/0029.
- **Connection layer** (`src/lib/supabase/`): `env.ts` (Zod validation, fail-fast, memoized), `client.ts` (browser), `server.ts` (server, cookie-based), `middleware.ts` (`updateSession` session refresher).
- **Root middleware** (`src/middleware.ts`) refreshes the auth session on every request.
- Removed the obsolete `src/lib/supabase.ts` placeholder (nothing imported it).
- Installed `@supabase/ssr`.
- Setup doc: `docs/supabase-setup.md` (env vars, how to apply migrations, first-admin promotion).

**Decisions / deviations during build:**
- Added a `prevent_role_self_escalation` trigger (not in the original spec) — the plain UPDATE policy would otherwise let a user set their own `role = 'admin'`. Role changes are allowed only from a privileged context (dashboard/service role) or by an existing admin.
- Env validation is **lazy + memoized** (`getSupabaseEnv`) rather than evaluated at import — so it fails fast on first use (e.g. middleware on the first request) while remaining unit-testable. The pure `parseSupabaseEnv` function is covered by tests.

**Applied & verified (2026-06-17):** all three migrations were applied to the live project via the SQL Editor (MCP is read-only). Verified through MCP: `public.users` table present with RLS enabled, correct columns/checks, PK and FK to `auth.users`; `photos` bucket + policies present. **Security advisor: 0 warnings** after the trigger-function EXECUTE revoke. RLS/storage runtime behaviour (cross-user denial, etc.) still to be exercised in `/qa`.

**Tests:** `src/lib/supabase/env.test.ts` — 4 passing (valid env; missing URL; invalid URL; missing anon key). No API routes in this feature, so no route tests. Typecheck (`tsc --noEmit`) passes. (Project-wide `npm run lint` is broken: Next 16 removed `next lint` while the repo still uses `.eslintrc` — pre-existing, unrelated to this feature.)

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
