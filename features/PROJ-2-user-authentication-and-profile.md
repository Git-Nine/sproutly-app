# PROJ-2: User Authentication & Profile

## Status: In Progress
**Created:** 2026-06-18
**Last Updated:** 2026-06-18

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
- [ ] Operator config (verify in `/backend`): email template must include the 6-digit token; Site URL + redirect URLs set for the callback route.

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

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
