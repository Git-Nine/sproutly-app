# Feature Index

> Central tracking for all features. Updated by skills automatically.

## Status Legend
- **Roadmap** - `/init` done, feature identified in feature map, no spec file yet
- **Planned** - `/write-spec` done, full spec written, architecture not yet designed
- **Architected** - `/architecture` done, tech design approved, ready to build
- **In Progress** - `/frontend` or `/backend` active or completed, not yet in QA
- **In Review** - `/qa` active, testing in progress
- **Approved** - `/qa` passed, no critical/high bugs, ready to deploy
- **Deployed** - `/deploy` done, live in production

## Features

| ID | Feature | Status | Priority | Depends on | Spec | Created |
|----|---------|--------|----------|-----------|------|---------|
| PROJ-1 | Supabase Infrastructure Setup | Approved | P0 | None | [PROJ-1](PROJ-1-supabase-infrastructure-setup.md) | 2026-06-17 |
| PROJ-2 | User Authentication & Profile | Approved | P0 | PROJ-1 | [PROJ-2](PROJ-2-user-authentication-and-profile.md) | 2026-06-17 |
| PROJ-3 | Photo Upload & Space Scan | Deployed | P0 | PROJ-1, PROJ-2 | [PROJ-3](PROJ-3-photo-upload-and-space-scan.md) | 2026-06-17 |
| PROJ-4 | Environmental Data Enrichment | Deployed | P0 | PROJ-3 | [PROJ-4](PROJ-4-environmental-data-enrichment.md) | 2026-06-17 |
| PROJ-5 | Plant Database & Admin Interface | Deployed | P0 | PROJ-1, PROJ-2 | [PROJ-5](PROJ-5-plant-database-and-admin-interface.md) | 2026-06-17 |
| PROJ-6 | Rule-Based Plan Generation | Roadmap | P0 | PROJ-3, PROJ-4, PROJ-5 | — | 2026-06-17 |
| PROJ-7 | Plan Review & Acceptance | Roadmap | P0 | PROJ-6 | — | 2026-06-17 |
| PROJ-8 | Shopping List & Deep Links | Roadmap | P0 | PROJ-7 | — | 2026-06-17 |
| PROJ-9 | Progress Photo Log | Roadmap | P1 | PROJ-7 | — | 2026-06-17 |

<!-- Add features above this line -->

## Build Order
PROJ-1 → PROJ-2 → PROJ-3 → PROJ-4 → PROJ-5 → PROJ-6 → PROJ-7 → PROJ-8 → PROJ-9

Notes:
- PROJ-4 (Environmental Enrichment) is split from PROJ-3 (Scan): separate concern, 3 external APIs, and a blocking open question on the BGR endpoint. The scan stores manual-form data on its own; enrichment augments it.
- PROJ-5 (Plant DB & Admin) must precede PROJ-6 (Plan Generation) — the rule engine can't run without seeded, rule-tagged plants.
- **Carried from PROJ-1 QA → PROJ-2:** runtime E2E verification of magic-link sign-in + auto-provisioned profile (AC-3), own-row RLS read/update + cross-user denial (AC-5/AC-6), and storage isolation upload/deny (AC-7/AC-8). PROJ-1 verified these structurally; PROJ-2's E2E suite must prove them against two real accounts.
- **Carried from PROJ-5 QA → PROJ-6:** two Low bugs about `plants.image_url`, deferred to where the image is first rendered. **BUG-1** — `image_url` has no DB-level format constraint (client `plantSchema` validates format only); add a `check (image_url ~ '^https?://')` or an app-layer guard. **BUG-2** — `plantSchema`'s `z.string().url()` accepts non-http(s) schemes (`javascript:`/`data:`); restrict to http(s) and render `image_url` only via a safe `<img src>` with an http(s) allowlist. Neither is exploitable in PROJ-5 (image is never rendered there). See PROJ-5 "QA Test Results" → Bugs found.

## Next Available ID: PROJ-10
