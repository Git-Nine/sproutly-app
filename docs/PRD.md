# Product Requirements Document — Sproutly

## Vision
Sproutly takes someone from a photo of their outdoor space to a personalised, ecologically grounded planting plan in under 5 minutes. It is the first product to connect local ecology, opinionated AI-assisted planning, and a clear path to purchase across the full **Scan → Plan → Order → Grow** journey. Germany-first.

## Target Users

### Primary
- **Maya (~34) — The Guilty Non-Starter.** Wants to act on climate anxiety but assumes plants mean commitment. Would order today if someone told her exactly what to get and promised it wouldn't take over her life. Needs: reassurance, a single decision made for her, a survival guarantee.
- **Thomas (~52) — The Pragmatic Rockery Defender.** Chose gravel for low maintenance and feels no guilt. Responds to evidence, not lectures. Needs to see natives beat gravel on time and effort before any environmental framing.

### Secondary
- Balcony gardeners — small space, climate-conscious, urban.
- Experienced gardeners wanting AI suggestions to review and override.

## The Problem
Millions replace gardens with gravel and sealed surfaces believing it is the low-effort, responsible choice. When they try to plan a garden instead, confidence collapses at the planning stage due to cognitive overload and decision paralysis. No existing product connects local ecology to personal action, addresses the hardscape-to-garden conversion, or removes planning anxiety through opinionated decisions. The result is inaction.

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | PROJ-1 Supabase Infrastructure Setup | Approved |
| P0 (MVP) | PROJ-2 User Authentication & Profile | Approved |
| P0 (MVP) | PROJ-3 Photo Upload & Space Scan | Deployed |
| P0 (MVP) | PROJ-4 Environmental Data Enrichment | Planned |
| P0 (MVP) | PROJ-5 Plant Database & Admin Interface | Planned |
| P0 (MVP) | PROJ-6 Rule-Based Plan Generation | Deployed |
| P0 (MVP) | PROJ-7 Plan Review & Acceptance | Deployed |
| P0 (MVP) | PROJ-8 Shopping List & Deep Links | Deployed |
| P1 | PROJ-9 Progress Photo Log | Roadmap |
| P1 | PROJ-10 In-App Notifications | Planned |
| P1 | PROJ-11 Plant Catalogue ETL (FloraWeb/BfN + AI trait mapping) | Planned |

See `features/INDEX.md` for dependencies and build order.

## Success Metrics

| Metric | Target |
|---|---|
| Time from photo upload to plan acceptance | Under 5 minutes |
| Plan acceptance rate without edits | 70%+ |
| Users who proceed from plan to shopping list | 50%+ |
| Users who return to log a second-season photo | 50% at 12 months |
| Support contacts about billing or trust issues | Under 5% of active users |

*Targets are directional hypotheses. Revise after the first 4 weeks of live usage.*

## Constraints
- **Platform:** Mobile-first PWA. Primary viewport 390px (iPhone 14).
- **Backend:** Supabase (Postgres + Auth + Storage). Row Level Security on all user-data tables (`user_id = auth.uid()`). Photos in private, user-namespaced Storage buckets (`/{user_id}/filename`). `plan_plants` RLS joins through `plans` to verify ownership. `plants` table: all authenticated users read, only admins write.
- **Admin access:** Role-based — a `role` column on `users`; admin routes gated by `role = 'admin'`.
- **Geography:** Germany-first. Native species, soil (BGR), hardiness zones, weather (DWD), and garden centre deep links scoped to Germany for v1.
- **External APIs (all free / open data):** BGR (soil), DWD (weather), hardiness zones, FloraWeb/BfN (plant database seeding).
- **Hosting:** Vercel (resolved at `/deploy`, 2026-06-18) — GitHub repo auto-deploys on push to `main`; env vars set in the Vercel dashboard.
- **Design system:** see `docs/design-system.md` — calm reassuring greens + warm neutrals, serif headings + Montserrat body, soft rounded white cards on a cream canvas. Built on Tailwind + shadcn/ui. Visual reference mockups in `docs/design-references/`.

## Non-Goals (v1)
Deferred to keep v1 focused on validating the core journey:
- AI / ML inference (vision, LLM) — clean swap-in points designed now, built later.
- Garden centre API integration — deep links cover v1.
- Survival Confidence Score — needs garden centre + soil data combined (v2).
- Push notifications / seasonal nudges (v2).
- Social / community features (v2).
- Food growing / vegetable planning — out of product scope.
- Professional / commercial landscaping — out of product scope.
- Plant diagnostics / disease detection (v2).
- Biodiversity scoring — unvalidated, research first.

## AI Swap-In Points (designed now, built later)
The v1 architecture separates concerns so AI can be introduced without restructuring the database or frontend:
- **Scan:** EXIF + manual form → vision model populates the same fields.
- **Plan generation:** rule engine queries plant DB → LLM augments or replaces it, same output shape.
- **Ordering:** deep links + shopping list → real garden centre API integration + Survival Confidence Score.

---

Use `/write-spec` to create detailed feature specifications for each roadmap item.
