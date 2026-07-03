# Sproutly MVP — How We Built It With Agentic AI

> A walkthrough for fellow AI-software-engineering trainees: what the app does, **and how it was built end-to-end by directing agentic AI** through a spec-driven, human-in-the-loop workflow.

---

## 1. The Product in One Slide
**Sproutly takes a photo of someone's garden and produces a personalised, survivable planting plan + a shopping list — in under 5 minutes.** Germany-first.

It's a real, full-stack MVP: auth, private database, photo storage, external data APIs, a rule engine, and a buy-flow — all shipped to production. That scope is the point: it's big enough to show how agentic AI handles a *whole* product, not a toy.

---

## 2. The Real Story: A Spec-Driven Agentic Workflow

The interesting part isn't the garden app — it's that **every feature went through the same disciplined AI pipeline**, with a human approving at each gate. No "vibe coding."

```
/init        → Define the product: PRD + prioritised feature map (run once)
/write-spec  → Write a full, testable spec for ONE feature
/architecture→ Design the tech approach (PM-friendly, no code yet)
/frontend    → Build the UI (shadcn/ui components first)
/backend     → Build APIs, DB schema, security rules
/qa          → Test against acceptance criteria + security audit
/deploy      → Ship to Vercel with production checks
```

Plus `/refine PROJ-X` to revisit any spec at any time.

### Why this matters for directing agentic AI
- **One feature per spec (Single Responsibility).** Small, bounded units = the agent stays on-task and output is reviewable.
- **Specs are the contract.** Acceptance criteria are written *before* code, so QA has something objective to test against.
- **Human-in-the-loop checkpoints.** The agent never jumps a phase without approval. You direct; it executes.
- **Specialised sub-agents.** Frontend, Backend, and QA are separate agents with their own tools and scope — the right context for the right job.
- **Persistent project memory.** `features/INDEX.md` tracks every feature's status (Roadmap → Planned → Architected → In Progress → In Review → Approved → Deployed). Each skill reads it at start and writes to it when done — so the AI never loses the thread across sessions.

---

## 3. Engineering Conventions That Keep Agents On-Rails

These are the guardrails that made agentic development reliable — worth stealing for your own projects:

| Convention | Why it helps when directing AI |
|------------|-------------------------------|
| **Sequential feature IDs** (PROJ-1…) | Stable references the agent and human both use. |
| **Commit format** `feat(PROJ-X): …` | Every commit traces back to a spec. |
| **Write-then-verify rule** | Agent must re-read a file after editing to confirm the change landed — no "I updated it" hallucinations. |
| **Read before modifying** | Never edit from memory; re-read after context compaction. |
| **shadcn/ui first** | Never re-invent installed components — less surface area for the agent to get wrong. |
| **Tests co-located** | Unit tests next to source; E2E in `tests/`. QA is built in, not bolted on. |

---

## 4. The Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript
- **UI:** Tailwind CSS + shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Storage)
- **Validation:** Zod + react-hook-form
- **Deploy:** Vercel (auto-deploy on push to `main`)

### Security model (enforced, not aspirational)
- **Row Level Security** on all user-data tables (`user_id = auth.uid()`) — users can only ever touch their own rows.
- **Private, user-namespaced storage** for photos (`/{user_id}/filename`).
- **Role-gated admin** routes (`role = 'admin'`) for the plant catalogue.
- A real QA finding from this build: a Zod `.url()` validator accepted `javascript:`/`data:` URLs — caught in `/qa`, restricted to http(s). That's the security audit phase earning its keep.

---

## 5. What Got Built — 8 Features, All Deployed

| # | Feature | The engineering challenge it solved |
|---|---------|-------------------------------------|
| 1 | **Infrastructure** | Auth + RLS + private storage foundation. |
| 2 | **Auth & Profile** | Passwordless magic-link login, GDPR account deletion. |
| 3 | **Photo Scan** | Camera/library upload, EXIF GPS extraction, structured space data. |
| 4 | **Data Enrichment** | Integrate 3 free German gov APIs (soil/BGR, weather/DWD, hardiness) with graceful degradation. |
| 5 | **Plant DB + Admin** | Seeded catalogue (40 native plants), admin CRUD, safe-delete with mandatory replacement. |
| 6 | **Plan Generation** | A rule engine: filter by survivability + sun, layer ecologically, scale species count to area, compute quantities. |
| 7 | **Plan Review** | Interactive editor, auto-save, staleness detection, duplicate-line merge. |
| 8 | **Shopping List** | Layer-grouped buy list + deep links to German nurseries, honest data flags. |

**Roadmap:** PROJ-9 Progress Photo Log, PROJ-10 In-App Notifications.

---

## 6. The Killer Detail: Designed-for-AI-Swap-In Architecture

The MVP deliberately uses **rules and manual input today** but is structured so AI/ML drops in *without restructuring the database or frontend*:

| Stage | v1 (built) | Swap-in (later) — same output shape |
|-------|-----------|-------------------------------------|
| **Scan** | EXIF + manual form | Vision model fills the same fields |
| **Plan** | Rule engine over plant DB | LLM augments/replaces, same output |
| **Order** | Deep links + shopping list | Real garden-centre API + survival score |

This is the lesson for AI engineers: **separate concerns so the AI layer is a swap, not a rewrite.** Define the interface first; the model is just one implementation behind it.

---

## 7. Takeaways for Your Own Agentic Projects

1. **Specs before code.** Acceptance criteria make the agent's output verifiable.
2. **Small, single-responsibility units.** One feature, one spec, one agent run.
3. **Gate every phase with a human.** Direct the agent; review at checkpoints.
4. **Give the AI persistent memory** (a status index) so it survives across sessions.
5. **Bake in write-then-verify** so the agent proves its changes instead of claiming them.
6. **Design seams for AI swap-in** — interface first, model later.
