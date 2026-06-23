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
| PROJ-6 | Rule-Based Plan Generation | Deployed | P0 | PROJ-3, PROJ-4, PROJ-5 | [PROJ-6](PROJ-6-rule-based-plan-generation.md) | 2026-06-17 |
| PROJ-7 | Plan Review & Acceptance | Deployed | P0 | PROJ-6 | [PROJ-7](PROJ-7-plan-review-and-acceptance.md) | 2026-06-17 |
| PROJ-8 | Shopping List & Deep Links | In Review | P0 | PROJ-7 | [PROJ-8](PROJ-8-shopping-list-and-deep-links.md) | 2026-06-17 |
| PROJ-9 | Progress Photo Log | Roadmap | P1 | PROJ-7 | — | 2026-06-17 |
| PROJ-10 | In-App Notifications | Planned | P1 | PROJ-5, PROJ-6 | [PROJ-10](PROJ-10-in-app-notifications.md) | 2026-06-22 |

<!-- Add features above this line -->

## Build Order
PROJ-1 → PROJ-2 → PROJ-3 → PROJ-4 → PROJ-5 → PROJ-6 → PROJ-7 → PROJ-8 → PROJ-9 → PROJ-10

Notes:
- PROJ-4 (Environmental Enrichment) is split from PROJ-3 (Scan): separate concern, 3 external APIs, and a blocking open question on the BGR endpoint. The scan stores manual-form data on its own; enrichment augments it.
- PROJ-5 (Plant DB & Admin) must precede PROJ-6 (Plan Generation) — the rule engine can't run without seeded, rule-tagged plants.
- **Carried from PROJ-1 QA → PROJ-2:** runtime E2E verification of magic-link sign-in + auto-provisioned profile (AC-3), own-row RLS read/update + cross-user denial (AC-5/AC-6), and storage isolation upload/deny (AC-7/AC-8). PROJ-1 verified these structurally; PROJ-2's E2E suite must prove them against two real accounts.
- **Carried from PROJ-5 QA → PROJ-6 (now owned in the PROJ-6 spec):** two Low bugs about `plants.image_url`, deferred to where the image is first rendered (the plan view in PROJ-6). **BUG-1** — `image_url` has no DB-level format constraint (client `plantSchema` validates format only); add a `check (image_url ~ '^https?://')` or an app-layer guard. **BUG-2** — `plantSchema`'s `z.string().url()` accepts non-http(s) schemes (`javascript:`/`data:`); restrict to http(s) and render `image_url` only via a safe `<img src>` with an http(s) allowlist. Both are now in PROJ-6's scope (Acceptance Criteria → "Image safety" + Technical Requirements). See PROJ-5 "QA Test Results" → Bugs found.
- **PROJ-10 (In-App Notifications) split from PROJ-7 (2026-06-22):** the "your plan was updated" reassignment notice (records + banner + My Spaces indicator, structured for a v2 inbox/bell/push) is its own P1 feature. PROJ-7 keeps plan editing, the Order seam, staleness, and the duplicate-line merge. PROJ-10 only needs PROJ-5 + PROJ-6 (its trigger) and surfaces on the plan view + My Spaces; it can be built any time after PROJ-6 but is sequenced after the P0 journey.

## Next Available ID: PROJ-11
