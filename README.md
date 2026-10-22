# 🌱 Sproutly

**From a photo of a garden to a personalised, ecologically grounded planting plan — in under 5 minutes.**

Sproutly is a full-stack, production-deployed Next.js application that takes a photo of an outdoor space and turns it into a survivable, native-plant planting plan and shopping list. It's Germany-first: every recommendation is grounded in real local data — government soil surveys, weather grids, and hardiness zones — not generic advice.

**Live app:** [sproutly-green.de](https://sproutly-green.de)
**Stack:** Next.js 16 · TypeScript · Supabase (Postgres/Auth/Storage) · Tailwind + shadcn/ui · Claude (Anthropic) · n8n · Vercel

---

## Why this project is worth a second look

This isn't a CRUD tutorial app. It's a real product with a real security model, a deterministic recommendation engine, two live AI integrations, and a test suite that actually gets run on every pull request:

- **26 database migrations**, Row Level Security enforced on every user-data table, and a private per-user storage namespace for uploaded photos — verified not just by code review but by **Playwright end-to-end tests that seed two real accounts and prove one user can never read another's data**.
- **A deterministic, pure rule engine** (`src/lib/plan-engine.ts`) that filters ~160 native species by sun, hardiness zone, soil, and physical fit, then layers and quantifies a plan — same inputs always produce the same output, so it's fully unit-testable and safe to reuse for interactive editing.
- **Two production AI integrations**, each with an explicit failure contract: a Claude vision workflow that pre-fills the photo-scan form, and a Claude-curated plan composition + natural-language rationale — both wired through n8n webhooks with hard timeouts, and both **degrade silently to the deterministic fallback** on any failure, so an AI outage never breaks the core journey.
- **A custom ETL pipeline** (`scripts/`) that pulls Germany's official native-plant data (FloraWeb/BfN), uses an LLM to infer ecological traits (pollinator/bird value, bloom windows) with a human-review gate before anything ships live, and syncs corrections back to production without ever clobbering hand-verified rows.
- **440 passing unit/integration tests** across 42 files (Vitest) plus **dedicated Playwright RLS-isolation suites** for auth, scans, plans, and admin routes — enforced by a GitHub Actions CI gate (lint → test → build) on every PR.
- **15 features shipped through a disciplined, spec-first workflow** — every feature has a written spec with acceptance criteria *before* code, a QA pass against those criteria, and a deploy log with rollback candidates. `features/INDEX.md` tracks all 15 end to end.

---

## The product

**The problem:** millions of people replace gardens with gravel and sealed surfaces, believing it's the responsible, low-effort choice. When they consider planting instead, decision paralysis wins — no product connects local ecology to a single, confident, personal decision.

**The flow — Scan → Plan → Order → Grow:**

1. **Scan** — upload a photo of the space (camera or library). EXIF GPS is extracted automatically; a Claude vision workflow pre-fills surface, space type, sun exposure, and area on an editable "here's what we see" screen.
2. **Enrich** — the app geocodes the location and pulls real environmental data: soil type (BGR), annual rainfall (DWD weather grid), and winter hardiness zone — all German open-government data sources, with graceful degradation if any one is unavailable.
3. **Plan** — the rule engine filters the ~160-species catalogue down to what can actually survive the site, then optionally hands the survivor list to a Claude-curated composition step that picks a considered mix and writes a plain-language rationale ("why this plan," "why this one"). Every plant shows a banded survival-confidence indicator instead of a fabricated percentage.
4. **Review & order** — an interactive plan editor (auto-save, staleness detection, duplicate-line merging) hands off to a layer-grouped shopping list with deep links to German nurseries.

Target users, from the product spec: *Maya*, who wants to act on climate anxiety but needs someone to make the decision for her, and *Thomas*, a pragmatic "rockery defender" who needs evidence before any environmental appeal.

---

## Architecture highlights

### Security model (enforced in the database, not just the app)
- Row Level Security on every user-data table (`user_id = auth.uid()`); the `plan_plants` policy joins through `plans` to verify ownership rather than trusting a client-supplied id.
- Uploaded photos live in a **private**, user-namespaced Storage bucket (`/{user_id}/filename`) — never publicly listable.
- Admin routes (plant catalogue CRUD) are gated by a `role` column, checked server-side.
- A real bug this rigor caught: a Zod `.url()` validator on plant images originally accepted `javascript:`/`data:` schemes — found in the QA phase, fixed before it shipped.

### AI designed as a swap-in, not a rewrite
The PRD deliberately built v1 with rules and manual input, but shaped every seam so AI/ML drops in without restructuring the database or frontend:

| Stage | v1 (built) | AI swap-in (built on top, same output shape) |
|---|---|---|
| Scan | Manual form + EXIF | ✅ Claude vision pre-fill, editable before save |
| Plan | Rule engine over the plant DB | ✅ Claude curates composition + writes rationale, engine still computes quantities and re-validates every AI answer |
| Order | Deep links + shopping list | Real garden-centre API + calibrated survival score (roadmap) |

Both AI routes share the same contract: **the server re-derives the ground truth itself** (survivors, RLS-scoped data) rather than trusting anything the model or client sends back, validates the AI's answer against a strict schema (IDs must be a subset of survivors, counts within bounds, length caps), and returns HTTP 200 with a "not curated" flag on *any* failure — timeout, malformed JSON, n8n outage — so a broken AI dependency degrades invisibly instead of breaking the user's plan.

### A pure, testable recommendation engine
`plan-engine.ts` is intentionally side-effect-free: no I/O, no `Date.now()`, no randomness. Given a scan, its environmental enrichment, the plant catalogue, and a maintenance preference, it always returns the same plan — which makes it trivial to unit test exhaustively and safe to reuse for the interactive plan editor without divergent logic paths.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui, Radix primitives |
| Backend | Supabase — Postgres, Auth (magic link), Storage, Row Level Security |
| Validation | Zod, react-hook-form |
| AI | Anthropic Claude (vision + text) via n8n webhook workflows |
| Testing | Vitest + Testing Library (unit/integration), Playwright (E2E + RLS isolation) |
| CI/CD | GitHub Actions (lint → test → build), Vercel (auto-deploy on push to `main`) |
| External data | BGR (soil), DWD (weather/climate grid), FloraWeb/BfN (native plant catalogue) |

---

## Quality bar

```
✓ 440/440 unit & integration tests passing   (vitest run — verified)
✓ 42 test files, co-located with source
✓ Dedicated Playwright suites proving cross-account RLS isolation
  for auth, scans, environmental enrichment, plans, and admin routes
✓ ESLint clean
✓ CI gate on every pull request: lint → test → build
```

Every one of the 15 shipped features went through the same pipeline: a written spec with acceptance criteria, an architecture pass, implementation, a QA pass that checks off each criterion and audits for security regressions, and a logged deploy with a recorded rollback candidate. The full history is in `features/INDEX.md` and `features/PROJ-*.md`.

---

## Project structure

```
sproutly-app/
├── src/
│   ├── app/                 Next.js App Router — pages + API routes
│   │   └── api/                 classify-vision, curate-plan, enrich, geocode, account
│   ├── components/           UI components (plans, admin, ui primitives)
│   ├── lib/
│   │   ├── plan-engine.ts       Pure, deterministic recommendation engine
│   │   ├── plan-confidence.ts   Banded survival-confidence scoring
│   │   ├── plan-curation.ts     AI curation validation + application
│   │   ├── enrichment/          Soil / climate / moisture enrichment pipeline
│   │   ├── bgr.ts, dwd-grid.ts  German open-data API clients
│   │   └── supabase/            Client, server, middleware, admin clients
│   └── hooks/
├── supabase/migrations/      26 SQL migrations (schema + RLS policies)
├── scripts/                  Plant catalogue ETL (FloraWeb import → AI trait
│                              inference → human review → sync to production)
├── tests/                    Playwright E2E + RLS-isolation suites
├── docs/                     PRD, design system, n8n workflow specs,
│                              production runbooks
└── features/                 One spec per feature, with QA + deploy logs
```

---

## Getting started

```bash
git clone https://github.com/Git-Nine/sproutly-app.git
cd sproutly-app
npm install
npx playwright install chromium   # one-time, for E2E tests

cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# (+ SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY if running the catalogue ETL)

npm run dev
```

```bash
npm test           # unit/integration tests (Vitest)
npm run test:e2e   # end-to-end + RLS isolation tests (Playwright)
npm run lint        # ESLint
npm run build       # production build
```

---

## What's shipped vs. roadmap

**Shipped (production):** infrastructure & auth, photo scan with AI pre-fill, environmental enrichment, plant catalogue & admin CRUD, rule-based plan generation, interactive plan review, shopping list, catalogue ETL, AI plan curation & rationale, survival-confidence banding, ecological trait enrichment.

**Roadmap:** progress-photo log, in-app notifications, a biodiversity indicator built on the verified ecological data already collected.

---

## Background

Built by **Janine Prange** ([@Git-Nine](https://github.com/Git-Nine)) as the capstone project for an AI Software Engineering bootcamp — an exercise in directing an agentic AI coding workflow through a full product build: spec → architecture → implementation → QA → deploy, with a human decision at every gate, rather than open-ended "vibe coding." Scaffolded from Alex Sprogis's "AI Coding Starter Kit" template (Claude Code skills, rules, and sub-agent scaffolding); every feature, data pipeline, and AI integration in `src/`, `scripts/`, `supabase/`, and `features/` — 96 commits across 15 shipped features — is original work built on top of it.

## License

MIT
