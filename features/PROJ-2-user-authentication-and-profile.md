# PROJ-2: User Authentication & Profile

## Status: In Review
**Created:** 2026-06-18
**Last Updated:** 2026-06-18 (QA — NOT production-ready: 1 High security bug)

## Dependencies
- Requires: **PROJ-1 (Supabase Infrastructure Setup)** — magic-link auth provider, `users` profile table, RLS, private `photos` bucket, and session-refresh middleware.

> **Note for `/architecture`:** PROJ-2 **extends** the `users` table with `display_name` and an avatar reference (e.g. `avatar_path`) — neither column exists yet.

## User Stories
- As a **new visitor**, I want to sign in with just my email (magic link), so that I can start without creating a password.
- As a **returning user**, I want my session to persist, so that I'm not constantly re-authenticating.
- As a **logged-in user**, I want to view and edit my profile (display name, picture, maintenance preference, experience level), so that the app reflects me and can personalize plans.
- As a **logged-in user**, I want to log out, so that I can secure my account on a shared device.
- As a **privacy-conscious user**, I want to delete my account and all my data, so that I stay in control (GDPR).
- As an **unauthenticated visitor**, I want to be redirected to login when I hit an app page, so that data stays protected.

## Out of Scope
- Password / social / OAuth login — **magic-link only** (PROJ-1 decision)
- Email change / re-verification flows — email is read-only
- Forced onboarding wizard — preferences are optional and editable later
- MFA / multi-factor authentication
- Admin user/role management UI — admins set manually (PROJ-1); `role` is **not** user-editable
- Public marketing landing / hero page — separate concern
- Per-scan maintenance capture — PROJ-3 (profile holds only the **default**)
- Avatar cropping / filters — simple upload / replace / remove only
- Display-name uniqueness, public profiles, social features
- Notification / email preferences

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Authentication
- [ ] Given a visitor on the login page, when they submit a valid email, then a magic link is sent and a "check your email" confirmation is shown.
- [ ] Given an empty or malformed email, when they submit, then a validation error is shown and no link is sent.
- [ ] Given a user received a magic link, when they click it, then they are authenticated and redirected to their intended destination (or home).
- [ ] Given an unauthenticated user, when they navigate to any protected route, then they are redirected to `/login` and returned to that route after sign-in.
- [ ] Given an authenticated user, when they visit `/login`, then they are redirected to home.
- [ ] Given a magic link that is expired or already used, when the user clicks it, then an error is shown with an option to request a new link.
- [ ] Given the email rate limit is hit, when the user requests another link, then a clear "please wait" message is shown.

### Session
- [ ] Given an authenticated user, when they return within the session's validity, then they stay logged in without re-authenticating.
- [ ] Given an authenticated user, when they click Log out, then the session ends and they are redirected to `/login`.

### Profile
- [ ] Given a logged-in user on the profile screen, when it loads, then email shows read-only and display name, picture, maintenance preference, and experience level show current values or placeholders.
- [ ] Given a logged-in user, when they edit display name / preferences and save, then changes persist and a success confirmation is shown.
- [ ] Given a display name over the 50-character max, when they save, then a validation error is shown and nothing is saved.
- [ ] Given a logged-in user, when they upload an allowed image (JPEG/PNG/WebP) under 5 MB, then it is stored privately and shown as their avatar.
- [ ] Given a disallowed file type or a file over 5 MB, when they upload, then an error is shown and no upload occurs.
- [ ] Given a user with a profile picture, when they remove it, then the avatar reverts to the initials/placeholder.
- [ ] Given a user with no display name, when the profile or app chrome renders, then initials / email-prefix are shown as a fallback.

### Account Deletion
- [ ] Given a logged-in user, when they choose "Delete my account", then a confirmation dialog appears before anything is deleted.
- [ ] Given the confirmation dialog, when they confirm, then their account, profile row, and all stored files are deleted, and they are logged out and sent to `/login`.
- [ ] Given the confirmation dialog, when they cancel, then nothing is deleted.

### Security (incl. PROJ-1 carried-forward runtime ACs)
- [ ] Given two users, when A is logged in, then A can read/edit only A's own profile, never B's. *(carries PROJ-1 AC-5/AC-6)*
- [ ] Given a logged-in user, when they upload an avatar, then it lives under their own namespace and is not accessible to other users. *(carries PROJ-1 AC-7/AC-8)*
- [ ] Given a first-time magic-link sign-in, when it succeeds, then a profile row exists with `role = 'user'`. *(carries PROJ-1 AC-3)*
- [ ] Given a regular user, when they attempt to set their own `role` to admin, then it is rejected (role is not user-editable). *(carries PROJ-1 role-escalation guard)*

## Edge Cases
- Magic link opened in a **different browser/device** than requested (PKCE may require the same browser — confirm UX).
- Clicking a magic link while **already logged in** (same or different account).
- **Network failure** during profile save or avatar upload → error shown, input preserved.
- **Concurrent edits** from two tabs → last write wins (no locking for v1).
- Avatar **upload succeeds but the DB update fails** → orphaned file; needs cleanup/consistency handling.
- **Account-deletion failure mid-flight** → partial-deletion handling / retry.
- Display name with **emoji/unicode** at the length boundary.
- **Session expires mid-use** → next action redirects to login.
- Clicking an **old magic link after the account was deleted**.

## Technical Requirements (optional)
- **Security:** route protection enforced in middleware; owner-only RLS (PROJ-1); avatars private + served via short-lived signed URLs; `role` never writable by end users.
- **Mobile-first:** primary viewport 390px.
- The PROJ-1 carried-forward ACs (AC-3/5/6/7/8) must be covered by this feature's E2E suite, exercised against two real accounts.

## Open Questions
- [x] Magic-link cross-browser/device behavior under PKCE — **Resolved (/architecture):** add a 6-digit code fallback so the user can complete sign-in on the requesting device.
- [x] Avatar orphan cleanup if the DB update fails after a successful upload — **Resolved (/architecture):** fixed per-user avatar path + overwrite, so there is at most one avatar file per user (no orphan pile-up).
- [x] Session lifetime / "remember me" duration — **Resolved (/architecture):** accept Supabase defaults.
- [x] Logout scope — **Resolved (/architecture):** current session/device only.
- [~] Operator config (from `/backend`): code is complete, but three manual steps remain for the operator before QA — apply the PROJ-2 migration, set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, and configure the email template (6-digit token) + Site URL/redirect URLs for `/auth/callback`. See Implementation Notes (Backend).

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Optional profile, no forced onboarding | Minimize friction for Maya; scan captures maintenance per-space; preferences personalize but don't gate entry | 2026-06-18 |
| Whole app login-gated for v1 | Simpler security model; all core data is user-owned | 2026-06-18 |
| Magic-link only (no password/social) | Inherited from PROJ-1; low friction, no password management | 2026-06-18 |
| Display name optional, ≤50 chars, no uniqueness | Cosmetic personalization; falls back to initials/email | 2026-06-18 |
| Avatar in existing private `photos` bucket, ≤5 MB, JPEG/PNG/WebP | Reuse PROJ-1 infra; no social/sharing in v1 so private suffices | 2026-06-18 |
| Self-service account deletion included | GDPR posture; exercises PROJ-1 cascade deletion | 2026-06-18 |
| Email read-only | Email is the magic-link identity; change/verify flow out of scope | 2026-06-18 |
| `role` not user-editable | Security; admins assigned manually (PROJ-1) | 2026-06-18 |

### Technical Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| Magic link (PKCE, `/auth/callback`) + 6-digit code fallback | Secure server-side flow; the code lets a user complete sign-in on the requesting device if the link opens on a different device/browser | 2026-06-18 |
| Route protection in middleware (extends PROJ-1's session refresher) | One central gate for all protected routes; also bounces logged-in users off `/login` — no per-page guards to forget | 2026-06-18 |
| Profile reads/writes server-side; only safe columns writable (never `role`) | Defense-in-depth on top of PROJ-1's escalation guard; client can't submit a role change | 2026-06-18 |
| Avatar stored at a fixed per-user path in the private `photos` bucket, overwrite-on-replace, shown via signed URL | Bounds avatar files to one per user (solves the orphaned-file edge case); private bucket reuse (no social/sharing in v1) | 2026-06-18 |
| Account deletion via a server-only privileged route using the service-role key | Deleting an auth user requires the service-role key, which must stay server-side; this route is the single place it is used; triggers PROJ-1 cascade (profile row + files) | 2026-06-18 |
| Accept Supabase session defaults; logout = current device only | Sensible defaults; per-device logout matches user expectation and keeps scope small | 2026-06-18 |
| No new packages | `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `react-hook-form`, and shadcn components are all already installed | 2026-06-18 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Screens & Components

```
/login  (public)
├── Email form — enter email, request sign-in
└── Confirmation state ("check your email")
    ├── 6-digit code input → verify on THIS device  ← cross-device fallback
    └── "…or tap the link in the email" + Resend (with rate-limit message)

/auth/callback  (public)
└── Handles the magic-link click → completes sign-in → redirects to returnTo/home

App (everything else, protected)
└── Middleware redirects unauthenticated visitors → /login?returnTo=…
    and redirects already-logged-in users away from /login

/profile  (protected)
├── Avatar — upload / replace / remove; initials placeholder when empty
├── Email — read-only
├── Display name — editable (≤50 chars)
├── Maintenance preference — select (low / medium / high)
├── Experience level — select (beginner / intermediate / expert)
├── Save → success toast
├── Log out
└── Delete account → confirm dialog → wipes everything → back to /login
```

Built entirely from existing shadcn components (`form`, `input`, `button`, `avatar`, `select`, `alert-dialog`, `sonner`, `card`).

### Data Model (plain language)
**Extends PROJ-1's `users` table** with two optional fields:
- **Display name** — optional text, up to 50 characters
- **Avatar reference** — the storage path of the user's picture (or empty)

Everything else (`email`, `role`, `maintenance_preference`, `experience_level`) already exists. The **avatar image** lives in PROJ-1's existing **private `photos` bucket** at a fixed per-user path (one avatar file per user; replacing overwrites), shown via a short-lived signed URL.

### Tech Decisions (summary)
See the Technical Decisions table above. Key points: PKCE magic link + 6-digit code fallback; route protection centralized in middleware; profile writes server-side with `role` never accepted from the client; fixed-path avatar overwrite; account deletion through a single server-only service-role route that triggers PROJ-1's cascade; Supabase session defaults; current-device logout.

### Dependencies to Install
- **None** — all required packages (`@supabase/ssr`, `@supabase/supabase-js`, `zod`, `react-hook-form`) and shadcn components are already present.

### New Operator / Config Items (for `/backend` + setup)
- Add a **server-only** `SUPABASE_SERVICE_ROLE_KEY` env var (never `NEXT_PUBLIC_`) — used solely by the delete-account route.
- Supabase dashboard: include the **6-digit token** in the email template (enables the code fallback) and set the **Site URL + redirect URLs** for `/auth/callback`.

### Notes for Implementation
- This feature needs **both** `/frontend` (login, profile, avatar UI) and `/backend` (callback route, profile update + avatar upload server logic, delete-account route, middleware route-gating).
- The PROJ-1 carried-forward runtime ACs (AC-3/5/6/7/8) should be exercised by this feature's E2E suite against two real accounts.

## Implementation Notes (Frontend)

**Design-system foundation (applies app-wide):**
- Retheme to Sproutly palette in `globals.css` (cream canvas, forest-green primary, taupe secondary, sage accent, terracotta destructive) + softer `--radius`; added `.eyebrow` label utility.
- Fonts wired in `layout.tsx`: **Montserrat** (body), **Fraunces** (serif headings), **IBM Plex Mono** (eyebrow labels) via `next/font`; `fontFamily` mapped in `tailwind.config.ts`.
- `providers.tsx` forces the light theme (cream) regardless of OS; Sonner `<Toaster>` mounted in layout.

**Screens & components built:**
- `app/login/page.tsx` (server; redirects authed users away, open-redirect-safe `returnTo`) → `components/auth/login-form.tsx` (client): email → `signInWithOtp` (magic link), then **6-digit code** via `verifyOtp`; resend + "use a different email"; rate-limit (429) messaging.
- `app/profile/page.tsx` (server; redirects unauthed → `/login?returnTo=/profile`; loads row with `select('*')`, signs avatar URL) → `components/profile/profile-form.tsx` (client) composing `avatar-uploader.tsx` (uploads to PROJ-1 private bucket at fixed path `{user_id}/avatar`, signed-URL preview, replace/remove) and `account-actions.tsx` (logout; delete-account `AlertDialog`).
- `app/page.tsx` — protected home placeholder (redirects unauthed → `/login`).
- `components/brand/logo.tsx` — leaf + serif wordmark.
- Validation/constants in `lib/profile.ts`; reused PROJ-1's `@/lib/supabase/{client,server}`.

**Verification:** `tsc --noEmit` clean · unit tests 4/4 · `next build` succeeds (`/`, `/login`, `/profile` + middleware).

**Pending the PROJ-2 backend step (UI is wired to these contracts):**
- **`users` migration** adding `display_name` + `avatar_path` — until applied, *saving those two fields* errors (maintenance/experience save fine now). The profile read tolerates their absence via `select('*')`.
- **`/auth/callback`** route handler (PKCE code exchange) — needed for the *magic-link tap* path; the 6-digit code path already works end-to-end.
- **`/api/account/delete`** route (service-role) — the delete dialog POSTs here.
- **Middleware route-gating** — PROJ-1's middleware only refreshes the session; pages currently self-guard via server-side `getUser()`. Also resolve the Next 16 `middleware`→`proxy` rename deprecation.
- Dashboard: add the 6-digit token to the email template; set Site URL + redirect URLs for `/auth/callback`.

## Implementation Notes (Backend)

**Database (`supabase/migrations/20260618120000_proj2_users_profile_fields.sql`):**
- Extends `public.users` with `display_name` (text, `<= 50` chars enforced by a CHECK as server-side defense-in-depth) and `avatar_path` (text, nullable). `add column if not exists` → idempotent. RLS, owner-only policies, and the role-escalation trigger are inherited unchanged from PROJ-1.
- ⚠️ **Migration not yet applied to the remote DB** — the Supabase MCP is in read-only mode and there is no local CLI/link. **Action required:** run this migration's SQL in the Supabase dashboard SQL editor (same way PROJ-1 was applied) before saving display name / avatar will persist.

**Routes built:**
- **`/auth/callback` (`route.ts`)** — GET handler for the magic-link *tap* path: exchanges the PKCE `code` for a session and redirects to a validated `returnTo` (open-redirect-guarded). On an expired/used/missing code, redirects to `/login?error=link_invalid` (preserving `returnTo`). The 6-digit code path does not pass through here.
- **`/api/account/delete` (`route.ts`)** — POST handler; verifies the caller's session (401 if absent), then uses the **service-role** admin client to `auth.admin.deleteUser(user.id)`. The id comes only from the verified session, never the client. Deletion triggers PROJ-1's cascade (profile row via FK, photos via `on_auth_user_deleted`). Returns 500 on failure; the client signs out + redirects on success.

**Auth/session infrastructure:**
- **Route-gating moved into the proxy** (`src/lib/supabase/middleware.ts` → `updateSession`): unauthenticated visitors to protected pages are redirected to `/login?returnTo=…`; already-signed-in users are bounced off `/login`. **API routes are exempt** from the redirect so `fetch()` gets a real 401 instead of a 307→HTML that would masquerade as success. Refreshed auth cookies are carried onto redirect responses. Pages still keep their own server-side `getUser()` guards (defense-in-depth).
- **Next 16 `middleware`→`proxy` rename resolved:** `src/middleware.ts` → `src/proxy.ts`, exporting `proxy`. Build confirms `ƒ Proxy (Middleware)`.
- **Service-role admin client** (`src/lib/supabase/admin.ts`): reads `SUPABASE_SERVICE_ROLE_KEY` (server-only, no `NEXT_PUBLIC_`); used solely by the delete route. No new package added (`server-only` guard omitted; the non-public env var is `undefined` in the browser, so a client import throws).

**Profile writes — kept client-side (decision this step):** the built frontend updates `public.users` directly via the browser client. RLS (owner-only) + the PROJ-1 role-escalation trigger already enforce the security the spec's "server-side writes" decision aimed for, and the form never sends `role`. Chosen over building a redundant `/api/profile` route to avoid rewiring working UI. Avatar uploads remain client-side to the private bucket (storage RLS enforces the per-user namespace).

**Operator config still required (not code):**
- Apply the migration above.
- Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (the secret/service-role key — **never** `NEXT_PUBLIC_`). `.env.local.example` could not be updated automatically (env files are permission-blocked); add the line there too.
- Supabase dashboard: include the **6-digit token** in the magic-link email template; set **Site URL + redirect URLs** to allow `/auth/callback`.

**Verification:** `tsc --noEmit` clean · `next build` succeeds (all routes + Proxy) · tests **13/13** (env 4, delete route 4, callback route 5). Route tests cover happy path, 401 unauth, session-id-only authorization, 500 failure, valid/invalid/missing code, and the open-redirect guard.

## QA Test Results

**QA date:** 2026-06-18 · **Tester:** QA Engineer (`/qa`) · **Build:** `next build` ✓ (9 routes + Proxy) · **Verdict:** ⛔ **NOT production-ready** — one High security finding (open redirect in the auth flow). No Critical bugs.

### Environment / setup verification
- ✅ PROJ-2 migration **is applied** to the remote DB — `public.users` has `display_name` (with the `char_length <= 50` CHECK) and `avatar_path`. (The spec's "migration not yet applied" warning is now resolved.)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` present in `.env.local` (server-only, no `NEXT_PUBLIC_`).
- ✅ Supabase security advisor: only `auth_leaked_password_protection` (WARN) — **N/A** to PROJ-2 (magic-link only, no passwords).
- ⚠️ Email-template 6-digit token + Site/redirect URLs are a dashboard setting QA can't introspect; the OTP path is wired correctly in code.

### Test coverage
- **Unit/integration (Vitest): 49/49 pass.** New: `src/lib/profile.test.ts` (24 cases — `initialsFor`, `validateAvatarFile`, `profileSchema`, email/OTP schemas, incl. boundary + emoji/unicode-adjacent cases). Existing route/env tests (delete route, callback route, env) all pass.
- **E2E (Playwright): 12/12 pass** on **Chromium (desktop)** and **Mobile Safari (iPhone 13, 390px)** — `tests/PROJ-2-auth-profile.spec.ts`. Covers the acceptance criteria reachable without a live authenticated session.
- Vitest config scoped to `src/**` so it no longer tries to run Playwright specs in `tests/`.

### Acceptance criteria
Legend: ✅ verified (automated) · 🟡 verified by code/migration + unit/route tests, **runtime not exercised** (needs real magic-link/OTP sign-in) · ⚠️ caveat.

**Authentication**
- ✅ Empty / malformed email → validation error, no link sent. *(E2E, both browsers)*
- ✅ Unauthenticated → protected route → redirect to `/login?returnTo=…`. *(E2E)* — the "returned to that route after sign-in" half is 🟡 (returnTo plumbing verified in code).
- ✅ Expired/used link → error shown with option to request a new one. *(callback route test + E2E `?error=link_invalid` message)*
- 🟡 Valid email → magic link sent + "check your email" confirmation. *(Confirmation UI + `signInWithOtp` wiring verified; the actual send is not auto-tested — it mutates state / sends real email / hits rate limits.)*
- 🟡 Click magic link → authenticated + redirected. *(`/auth/callback` PKCE exchange covered by route tests; needs a real link at runtime.)*
- 🟡 Authenticated visits `/login` → redirected home. *(middleware + page guard verified.)*
- 🟡 Rate limit hit → "please wait" message. *(429 handling present in `login-form.tsx`.)*

**Session**
- 🟡 Session persists within validity. *(Supabase defaults + proxy refresh.)*
- 🟡 Log out → session ends → `/login`. *(verified in code; see BUG-5 re: error path.)*

**Profile**
- ✅ Disallowed type / >5 MB → error, no upload. *(unit: `validateAvatarFile`)*
- ✅ No display name → initials / email-prefix fallback. *(unit: `initialsFor`)*
- 🟡 Profile loads: email read-only, fields show values/placeholders. *(server load + form verified.)*
- 🟡 Edit + save → persists + success toast. *(client update under owner-only RLS verified.)*
- 🟡 Upload allowed image <5 MB → stored privately + shown as avatar. *(upload + signed-URL preview verified.)*
- 🟡 Remove picture → reverts to initials. *(verified; see BUG-2 consistency caveat.)*
- ⚠️ Display name > 50 chars → validation error: the input's `maxLength={50}` makes the over-limit **error state unreachable via the UI**. The "nothing is saved" outcome holds (prevention + zod `.max(50)` + DB CHECK), but the AC's "a validation error is shown" can't be demonstrated through the form. See BUG-6 (observation).

**Account Deletion**
- 🟡 Delete → confirm dialog appears; Cancel → nothing deleted; Confirm → account/profile/files deleted + logout → `/login`. *(AlertDialog + delete route logic covered by route tests — happy path, 401 unauth, session-id-only authorization, 500 failure; the destructive cascade against a real account is not exercised.)*

**Security (carried-forward PROJ-1 runtime ACs)** — all 🟡 **structurally verified, runtime NOT exercised against two real accounts** (see Residual risk):
- 🟡 A reads/edits only A's own profile, never B's. *(owner-only RLS policies present.)*
- 🟡 Avatar lives under the user's own namespace, not accessible to others. *(fixed `{user_id}/avatar` path + storage RLS.)*
- 🟡 First sign-in → profile row with `role = 'user'`. *(`handle_new_user` trigger.)*
- 🟡 Regular user can't set own `role` to admin. *(`prevent_role_self_escalation` trigger restores old role; the profile form never sends `role`.)*

### Bugs found

| ID | Severity | Title |
|----|----------|-------|
| BUG-1 | **High** (security) | Open redirect in auth `returnTo` via backslash bypass |
| BUG-2 | Low | Avatar storage/DB inconsistency when removing/uploading without saving |
| BUG-3 | Low | `SUPABASE_SERVICE_ROLE_KEY` not documented in `.env.local.example` |
| BUG-4 | Low | No working lint (`next lint` removed in Next 16; no `eslint.config.js`) |
| BUG-5 | Low | `handleLogout` doesn't reset loading state / handle a failed `signOut` |
| BUG-6 | Low (observation) | Display-name >50 validation error unreachable via UI (`maxLength`) |

**BUG-1 — Open redirect in auth `returnTo` (High, security).**
`safeReturnTo` guards with `value.startsWith('/') && !value.startsWith('//')`. A value of `/\evil.com` (slash + backslash) passes the guard, and browsers normalize the backslash to `/`, resolving it to `http://evil.com/` (verified empirically).
- **Exploitable in:** `src/app/login/page.tsx` (`redirect(safeReturnTo(returnTo))`) and `src/components/auth/login-form.tsx` (`window.location.href = returnTo` after OTP sign-in).
- **Not exploitable in:** `src/app/auth/callback/route.ts` and `src/lib/supabase/middleware.ts` — both build an absolute URL on a hardcoded origin, so `/\evil.com` collapses to a same-origin `//evil.com` path.
- **Repro:** open `/login?returnTo=/%5Cevil.com`, sign in with the 6-digit code → browser lands on `evil.com`. Phishing / credential-harvest vector.
- **Steps for the fix (frontend/backend skill):** in the shared `safeReturnTo` helper, also reject values containing a backslash (and ideally any control chars) — e.g. return `'/'` unless `/^\/(?!\/)[^\\]*$/` matches. The helper is **duplicated in 4 files**; consider centralizing it in `lib/` so the fix lands once. Auth-flow change → per the project's security rules, get explicit approval.

**BUG-2 — Avatar remove/upload not atomic with Save (Low).** `avatar-uploader.tsx` deletes/overwrites the Storage object immediately, but `users.avatar_path` is only persisted on "Save changes". Abandoning after Remove leaves the DB pointing at a deleted object (next load 404s the signed URL → falls back to initials, so it degrades gracefully but the row is stale). Abandoning after a first upload leaves a stored object with `avatar_path` still null. Low impact (fixed path → no orphan pile-up). Consider persisting the path change in the same action as the storage mutation.

**BUG-3 — Undocumented env var (Low).** `.env.local.example` lists only the two `NEXT_PUBLIC_` vars; `SUPABASE_SERVICE_ROLE_KEY` (required by the delete route) is missing. Security rules require documenting new env vars. (Env files were permission-blocked for the implementer — needs a manual one-line add with a dummy value.)

**BUG-4 — No working lint (Low, project-wide).** `npm run lint` runs `next lint`, removed in Next 16, and there's no `eslint.config.js`, so linting errors out entirely. Not a PROJ-2 functional defect but a CI/quality gap surfaced here. Migrate to flat-config ESLint (`eslint.config.mjs`) and update the script.

**BUG-5 — Logout loading state (Low).** `account-actions.tsx#handleLogout` sets `loggingOut = true` then calls `signOut()` + redirect with no try/catch; if `signOut()` rejects, the button spins indefinitely and no redirect occurs. Wrap in try/finally and reset state on error (matches the project's "reset loading in all code paths" rule, which `handleDelete` already follows).

**BUG-6 — Display-name >50 error unreachable (Low / observation).** See the AC note above. Defense is adequate (prevention + zod + DB CHECK); flagged only for AC traceability.

### Informational (not bugs)
- **CSRF on `/api/account/delete`:** no CSRF token, but Supabase SSR auth cookies are `SameSite=Lax`, so a cross-site POST won't carry them. Acceptable for v1.
- **Client-only avatar validation:** `validateAvatarFile` runs client-side and is bypassable via a direct Storage call, but uploads are confined to the user's private namespace by Storage RLS, served only to the owner via signed URL, and SVG is excluded — low residual risk. For defense-in-depth, consider per-bucket allowed-MIME/size limits in the PROJ-1 Storage config.

### Residual risk (must close before deploy)
The four carried-forward security ACs (own-row RLS read/edit + cross-user denial, avatar storage isolation, auto-provisioned `role='user'`, role-escalation rejection) and the authenticated happy-paths are verified by **code/migration review + unit/route tests only** — they were **not exercised against two real authenticated accounts**, because magic-link/OTP sign-in requires real email access this QA pass didn't have. This is the same gap PROJ-1 carried forward. **Recommended:** add a seeded-auth E2E harness using the admin API (`auth.admin.generateLink` to obtain a token, then `verifyOtp`) to mint two real sessions and assert cross-user RLS/storage denial end-to-end, or do a documented manual two-account pass.

### Production-ready decision
⛔ **NOT READY.** BUG-1 is a confirmed, exploitable open redirect in the authentication flow — small fix, but it should not ship. Fix BUG-1 (and ideally BUG-3/BUG-5), then re-run `/qa`. The Low items and the runtime-AC gap are non-blocking individually but the two-account runtime verification should be closed before `/deploy`.

### Post-QA fixes (2026-06-18)

Applied after the QA pass above (branch `proj-2-qa`), with explicit approval for the auth-flow change:

- **BUG-1 (High) — FIXED.** Centralized the redirect guard in `src/lib/safe-return-to.ts` (rejects protocol-relative `//`, the `/\` backslash bypass, any backslash, and control characters) and wired it into all four call sites: `login/page.tsx`, `login-form.tsx` (re-sanitized at the `window.location` redirect, defense-in-depth), `auth/callback/route.ts`, and `supabase/middleware.ts`. Removed the four duplicated copies. Covered by `src/lib/safe-return-to.test.ts` (16 cases incl. the `/\evil.com` exploit).
- **BUG-2 (Low) — FIXED.** `avatar-uploader.tsx` now persists `avatar_path` to the row immediately, atomic with the storage mutation (upload → set path; clear path → remove file), so an abandoned form can't leave the row pointing at a missing object. Toasts updated ("Picture updated." / "Picture removed.").
- **BUG-4 (Low) — FIXED.** Migrated lint to ESLint 9 flat config (`eslint.config.mjs` using `@next/eslint-plugin-next`'s `core-web-vitals`); removed `.eslintrc.json`; `lint` script is now `eslint .`. `npm run lint` runs clean.
- **BUG-5 (Low) — FIXED.** `handleLogout` wrapped in try/catch — resets the loading state and toasts on a failed `signOut` instead of spinning forever.
- **BUG-3 (Low) — MANUAL (still open).** `.env.local.example` is permission-blocked from edits in this environment. **Operator action:** add a line `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key` (dummy value) to `.env.local.example`.
- **BUG-6 (observation) — ACCEPTED, no change.** The >50-char display-name error stays unreachable via the UI by design (`maxLength={50}` + zod `.max(50)` + DB CHECK). Defense is adequate; flagged for AC traceability only.

**Verification (proj-2-qa):** `tsc --noEmit` clean · `next build` green (6 routes + Proxy) · `npm run lint` clean · unit/integration **34/34** (incl. 16 new `safe-return-to` cases).

**Still open before `/deploy`:** re-run `/qa` to confirm the verdict, BUG-3 manual add, and the **two-account runtime verification** of the four carried-forward security ACs (now unblocked by SMTP) — either a manual two-account pass or a seeded-auth E2E harness (`auth.admin.generateLink` → `verifyOtp`).

## Deployment
_To be added by /deploy_
