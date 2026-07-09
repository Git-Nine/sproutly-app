# PROJ-12: AI Plan Curation & Rationale

## Status: In Progress
**Created:** 2026-07-07
**Last Updated:** 2026-07-08 (/backend complete — see Implementation Notes)

## Dependencies
- Requires: PROJ-6 (Rule-Based Plan Generation) — the hard-filter survivors, quantity maths, snapshot, and `findConstraintViolations()` guardrail this feature builds on
- Requires: PROJ-7 (Plan Review & Acceptance) — the plan view where the intro and per-plant rationale surface, and the edit/regenerate flows this feature must coexist with
- Soft: PROJ-11 (Plant Catalogue ETL) — a larger catalogue makes AI curation more valuable, but the feature works against the current seed catalogue

## Summary

This is the PRD's **Plan** AI swap-in point ("rule engine queries plant DB → LLM augments or replaces it, same output shape"), realized as *augmentation*: the rule engine's hard survival filters stay authoritative, and an AI curation step chooses the plant **composition** from the engine's survivors and writes a personalised **rationale** — a short plan-level intro plus a one-line "why this one" per plant. The engine keeps computing quantities and densities. Every AI-curated plan is validated by the existing survival-constraint guardrail before it is persisted; any failure (timeout, API error, invalid selection) silently falls back to the pure rule-engine plan, which is exactly today's behavior.

**Pipeline:**

```
Scan + enrichment
   │
   ▼
Rule engine: hard filters (sun / zone / fit)      ← unchanged, authoritative
   │  survivors only
   ▼
AI: choose the mix + write rationale               ← NEW (this feature)
   │
   ▼
Engine: quantities / densities                     ← unchanged
   │
   ▼
Guardrail check ──any failure──▶ pure rule-engine plan (today's behavior)
```

## User Stories
- As **Maya (Guilty Non-Starter)**, I want the plan to tell me *why* each plant belongs in my space and how little effort it needs, so that I trust the plan enough to accept it without second-guessing every line.
- As **Maya**, I want one confident, well-composed plan (not a raw filter result), so that the single decision is truly made for me.
- As **Thomas (Pragmatic Rockery Defender)**, I want concrete evidence — effort per month, watering needs, why this beats gravel on maintenance — not environmental lectures, so that I can judge the plan on my own terms.
- As an **experienced gardener** (secondary persona), I want to see the reasoning behind each pick, so that I can meaningfully review and override the AI's choices.
- As **any user**, I want my plan to appear reliably even when the AI is slow or down, so that a third-party outage never blocks my Scan → Plan journey.

## Out of Scope
- **Changing the hard survival filters or quantity maths** — the AI never sees non-survivors and never computes quantities; the PROJ-6 engine remains the sole authority on both.
- **AI re-runs on manual plan edits** — adding/removing plants or changing quantities in the PROJ-7 editor never triggers an AI call (decided in the interview; see Decision Log).
- **Persona-adaptive tone** (Maya-vs-Thomas branching) — one evidence-forward tone for v1; revisit if/when profiles carry a persona signal.
- **Partial repair of invalid AI selections** — if the AI's selection fails validation in any way, we fall back entirely to the rule-engine plan; no padding/patching of a half-good selection in v1.
- **Streaming the rationale in** — the plan appears once, complete; no progressive text streaming on the plan view in v1.
- **Rationale for user-added plants** — plants the user adds in the editor show their care notes only, never an AI "why" line (we didn't pick them; faking a rationale would be dishonest).
- **Chat / follow-up questions about the plan** — one-shot curation only; a conversational plan assistant is a separate future feature.
- **Rationale on historical plans** — plans generated before this feature ships simply have no rationale; no backfill.
- **PROJ-6 engine follow-ons** (consume `moisture`, weight `native`) — tracked separately in INDEX.md notes; not bundled here.
- **Survival Confidence Score** — PRD v2 non-goal; the disclosure line's "survival-checked" claim refers to the existing hard filters + guardrail, not a score.
- **Ordering AI swap-in point** (garden centre API integration) — PRD v2.

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Curation
- [ ] Given a scan with enrichment data and at least one hard-filter survivor, when a plan is generated, then the AI selects the plan's plant composition **only from the rule engine's hard-filter survivors** — a plant outside the survivor list can never appear in a curated plan.
- [ ] Given the AI has selected a composition, when the plan is assembled, then quantities and densities are computed by the existing engine maths (not by the AI), and the plan is persisted in the same shape as a rule-engine plan (same tables, same snapshot, PROJ-7/PROJ-8 work unchanged).
- [ ] Given an AI-curated composition, when the plan is validated before persisting, then the existing survival-constraint guardrail (`findConstraintViolations()`-equivalent check) passes with zero violations — a violation triggers full fallback, never a partially-repaired plan.
- [ ] Given the AI's selection size falls outside the engine's richness bounds for the site's area, when the plan is validated, then the selection is rejected and the pure rule-engine plan is persisted instead.

### Rationale
- [ ] Given a plan was AI-curated, when the user views the plan, then a plan-level intro of 2–3 sentences explains why this combination suits their specific site (referencing their actual conditions — e.g. sun, surface, soil), followed by a one-line disclosure: plant picks are AI-assisted and survival-checked against the site's conditions.
- [ ] Given a plan was AI-curated, when the user views a plant line, then a one-line "why this one" rationale appears alongside the existing care-notes blurb for every AI-picked plant.
- [ ] Given the rationale text, when it is generated, then it is concrete and effort/evidence-forward (references site conditions, maintenance effort, watering) and never moralizes about climate or guilt.
- [ ] Given a curated plan exists, when the user re-opens it later, then the same persisted intro and per-plant rationale are shown without any new AI call.

### Wait UX & fallback
- [ ] Given a new plan is being built, when the AI curation step runs, then the user sees a themed blocking interstitial ("Crafting your plan…", consistent with the existing "Reading your space…" pattern) and never a frozen or blank screen.
- [ ] Given the AI call exceeds the timeout or fails (API error, refusal, invalid response), when the plan build completes, then the pure rule-engine plan is persisted and shown with **no error message and no apology** — it looks exactly like today's plan (no intro, no "why" lines, no fabricated rationale).
- [ ] Given the AI feature is not configured in the environment (e.g. missing API key), when a plan is generated, then the rule-engine path runs directly with no user-visible difference from today and no interstitial delay attributable to AI.

### Edits & regeneration
- [ ] Given a curated plan, when the user removes a plant in the editor, then that plant's "why" line disappears with it and no AI call is made.
- [ ] Given a curated plan, when the user adds a plant themselves, then that line shows care notes but **no** AI "why" line, and no AI call is made.
- [ ] Given a stale or unchanged plan, when the user triggers "Regenerate", then the full pipeline including AI curation runs again and the previous rationale is replaced by the new one.

### Security & access
- [ ] Given an unauthenticated request, when the AI curation endpoint is called, then it is rejected (401) — consistent with the existing API-route auth guards.
- [ ] Given rationale text returned by the AI, when it is rendered on the plan view, then it is rendered as plain text (no HTML/markdown injection) and respects a maximum length so a runaway response cannot break the layout.

## Edge Cases
- **Zero or very few survivors** (e.g. tiny shaded paved strip): with 0 survivors, today's empty-plan behavior stands (no AI call — nothing to curate). With fewer survivors than the richness floor, the AI step is skipped or trivially returns all survivors; either way the outcome equals the rule-engine plan, and the rationale may still be generated for what's there.
- **AI returns plant IDs not in the survivor list** (hallucinated or from stale context): validation rejects the whole selection → full fallback. This is the guardrail's primary job.
- **AI returns too few/too many picks** (outside richness bounds for the area): rejected → full fallback (no padding in v1).
- **AI responds after the timeout**: the rule-engine plan has already been persisted; the late response is discarded — the plan must never change under the user after first paint.
- **Concurrent generation** (double-tap, two tabs): same protection as today's PlanBuilder flow — one plan per scan persists; the AI step must not create duplicate plans or double-charge tokens beyond one wasted call.
- **API refusal or content-filter response**: treated as failure → silent fallback (same class as timeout). The PROJ-11 `RefusalError` pattern applies.
- **Rationale mentions a plant that was later removed by the user**: per-plant lines are attached to lines so they leave with the plant; the plan-level intro is accepted as a snapshot of the *generated* plan and is not rewritten (consistent with the existing "snapshot, still honest when stale" pattern).
- **Very long/degenerate rationale text**: length caps enforced at validation; over-long text → treat as invalid response → fallback (never truncate mid-sentence into the UI).
- **Network drop mid-generation on the client**: same recovery as today's plan build — revisiting the plan URL resumes/rebuilds; a persisted curated plan is simply shown.

## Technical Requirements (boundaries for /architecture — the WHAT, not the HOW)
- **Latency budget:** AI curation adds at most ~15s (hard timeout) to plan generation; total photo-to-plan must stay comfortably inside the PRD's 5-minute journey target.
- **Reliability:** the Scan → Plan journey must have **zero added failure modes** — every AI failure path ends in today's rule-engine plan.
- **Security:** server-side only (API key never reaches the client); endpoint authenticated via the existing `requireUser()` guard; AI output validated against a locked vocabulary/ID list before persistence (PROJ-11's structured-output + Zod re-validation pattern is the house style).
- **Cost control:** at most one AI call per plan (re)generation; no calls on view, edit, or navigation.
- **Persistence:** intro + per-plant rationale stored with the plan (schema change expected — /architecture decides shape); plans remain fully functional with rationale absent (fallback plans, historical plans).
- **Language:** rationale in the app's UI language (English for v1, matching the current product surface).

## Open Questions
- [x] ~~Should the plan-level intro also state the estimated total monthly effort ("about 20 minutes a month")?~~ **Resolved in /architecture (2026-07-07): No.** Maintenance data is bucketed (low/medium/high), no minutes exist to derive honestly. Qualitative effort statements only ("every pick is low-maintenance").
- [ ] German-language rationale: PRD is Germany-first but the UI is English today. When the product localizes, rationale generation must follow — flagging so localization scope includes AI copy.
- [x] ~~Does AI curation need a per-user rate limit beyond "one call per (re)generation"?~~ **Resolved in /architecture (2026-07-07): Not for v1.** The authenticated one-call-per-(re)generation design is the cost control; a per-user cooldown can be added inside the route later if usage shows regenerate-spamming.

## Decision Log

### Product Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| AI picks **composition only**, from hard-filter survivors; engine keeps quantity maths | The AI never sees plants that can't survive the site, and never does area arithmetic (LLM weakness, engine strength). Keeps the PRD promise "same output shape". | 2026-07-07 |
| Registered as P1, not P0 | The P0 journey is deployed and works without AI; this iterates on plan quality. | 2026-07-07 |
| Blocking "Crafting your plan…" interstitial + hard timeout, silent fallback | Matches the existing vision-prefill wait pattern; the user always gets exactly one plan that never changes under them. A considered pause fits an "opinionated plan" better than a plan that visibly rewrites itself. | 2026-07-07 |
| Two-level rationale: plan intro (2–3 sentences) + one-line per-plant "why", both persisted | The intro sells the whole (composition, layering); the per-plant line defuses doubt exactly where users hesitate. Persisting avoids per-view cost and keeps the plan stable. | 2026-07-07 |
| AI runs only at (re)generation, never on manual edits | No surprise latency/cost mid-edit; regeneration is the natural refresh point. User-added plants get no fabricated "why". | 2026-07-07 |
| Full fallback on any invalid AI output — no partial repair | One simple, testable failure path; a half-repaired selection blurs responsibility between AI and engine. | 2026-07-07 |
| Subtle disclosure line ("AI-assisted and survival-checked"), no AI badge, no fallback apology | EU-appropriate transparency that doubles as a trust signal; loud AI branding risks triggering skepticism in the reassurance-seeking persona; fallback plans are simply today's plans. | 2026-07-07 |
| One evidence-forward tone for all users; personalize on site data + maintenance preference only | Serves Maya (reassurance, low effort) and Thomas (evidence, no lectures) with the same copy; we have no persona data to branch on, and guessing personas from thin signals risks getting it wrong. | 2026-07-07 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| AI call via n8n webhook (new "Plan Curation" workflow), not direct Anthropic SDK | User decision in /architecture. Keeps all production AI calls in one operational home alongside the scan-vision workflow; prompt editable without a deploy. Route mirrors `/api/classify-vision`: secret header, hard timeout, strict validation, silent fallback. Trade-off accepted: extra network hop + n8n as runtime dependency (mitigated by full fallback). | 2026-07-07 |
| New server route `/api/curate-plan`; plan persistence stays client-side | Only the AI step needs a server (key secrecy); saving keeps the established RLS client-write pattern (`persistGeneratedPlan`), so tables, PROJ-7 editing and PROJ-8 remain untouched. | 2026-07-07 |
| Route re-derives survivors server-side; never accepts a survivor list from the client | The pure `matchingSurvivors()` engine helper runs identically on the server, so a tampered client can't smuggle non-survivors into the AI's menu. Client re-runs `findConstraintViolations()` before persisting — two independent checks. | 2026-07-07 |
| Curated quantities via the existing `computeQuantities` maths (PROJ-7 rebalance path) | "Fixed plant set → fill the area" already exists and is guardrail-tested; no new arithmetic and no drift risk. | 2026-07-07 |
| Rationale stored as two nullable text columns: `plans.rationale_intro` + `plan_plants.rationale` | Presence of intro ≙ "AI-curated" (no separate flag); per-line why lives/dies with its line (user removals need no logic); NULL everywhere yields exactly today's plan (fallback + historical plans free). Length checks at DB level + route validation. | 2026-07-07 |
| Length caps enforced at three layers (AI answer format, route Zod validation, DB check) | An over-long/degenerate response is treated as invalid → full fallback, never truncated into the UI (spec edge case). Plain-text rendering only. | 2026-07-07 |
| No numeric monthly-effort claim in the intro (resolved open question) | Maintenance data is a low/medium/high bucket only — no minutes to derive honestly. Qualitative effort statements allowed. | 2026-07-07 |
| No extra per-user rate limit for v1 (resolved open question) | One authenticated AI call per (re)generation is the cost control; a cooldown can be added inside the route later without wider changes. | 2026-07-07 |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

**Designed:** 2026-07-07 · **Backend needed:** yes (one new API route, one n8n workflow, one small DB migration)

### The big picture

Plan generation today runs in the user's browser: the plan screen (or the Regenerate button) runs the rule engine and saves the result. That stays. The only new moving part is a **server-side "curation" step** slotted between the engine's hard survival filter and the quantity maths:

```
Browser: user lands on plan screen / taps Regenerate
   │
   ▼
NEW  Ask the server: "curate a plan for this scan"  ──▶  API route /api/curate-plan
   │                                                        │  1. checks the user is signed in
   │                                                        │  2. loads the scan, its conditions, and the catalogue
   │                                                        │  3. runs the SAME hard survival filter as the engine
   │                                                        │  4. sends survivors + site conditions to the n8n
   │                                                        │     "Plan Curation" workflow (Claude, locked output)
   │                                                        │  5. checks the AI's answer strictly (IDs, counts, lengths)
   │   ◀── curated picks + intro + per-plant "why" ─────────┘     any problem → answers "no curation" instead
   ▼
Browser: quantities via the EXISTING engine maths → guardrail check → save plan (+ rationale)
   │
   └── AI unavailable / slow / invalid at ANY point → run today's rule engine, save, done.
       (identical to today's plan — no error, no apology, no rationale)
```

Why this shape:
- **The AI key never reaches the browser.** All AI happens behind the new route; the browser only ever receives finished text and a list of plant IDs.
- **The server doesn't trust anyone.** The route re-derives the survivor list itself (it never accepts one from the browser), and it checks the AI's answer against that list before returning it. The browser then runs the existing survival guardrail once more before saving — two independent checks, same as the PROJ-6 philosophy.
- **Saving stays exactly as it is.** The plan is persisted by the same browser code path, into the same tables, in the same shape — PROJ-7 editing and PROJ-8 shopping list need zero changes to keep working.

### Component structure

```
Plan screen (/scans/{code}/plan)
+-- PlanBuilder            (existing auto-build — interstitial copy becomes
|                           "Crafting your plan…" while curation runs)
+-- GeneratePlanButton     (existing Regenerate — same new curation step)
+-- PlanEditor             (existing)
    +-- Conditions chips           (unchanged)
    +-- NEW  Plan intro card       (2–3 sentence rationale + one-line
    |                               "AI-assisted and survival-checked" disclosure;
    |                               only rendered when a rationale exists)
    +-- Plant lines                (existing)
        +-- care notes blurb       (unchanged)
        +-- NEW  "why this one"    (one plain-text line; only on AI-picked lines —
                                    user-added plants never get one)

Server side
+-- NEW  API route  /api/curate-plan     (auth-guarded; mirrors /api/classify-vision:
|                                         forwards to n8n, validates, silent fallback)
+-- NEW  n8n workflow  "Plan Curation"   (calls Claude with a locked answer format;
                                          documented like the scan-vision workflow)
```

No new visual components beyond two small text blocks styled with the existing card/typography system.

### Data model (plain language)

One small migration, two new optional text fields — nothing else changes:

- **On each plan:** a `rationale_intro` — the 2–3 sentence plan-level explanation. Empty for fallback plans and all historical plans. Its presence is also what tells the UI "this plan was AI-curated", so no separate flag is needed (the disclosure line and intro card appear together or not at all).
- **On each plan line:** a `rationale` — the one-line "why this one". Empty for user-added plants and all fallback/historical lines, so the "no fabricated why" rules fall out of the data shape automatically. When a user removes a plant, its line (and therefore its why) disappears with it — no extra logic.

Both fields have a hard length cap enforced in three places (the AI's answer format, the route's validation, and the database itself), so a runaway response can never reach the screen. Both are rendered as plain text only. No new tables, no RLS changes — the new fields ride the existing plan ownership rules.

### Tech decisions (why, for the PM)

1. **AI via the n8n "Plan Curation" workflow** (your call in this session): same operational home as the scan-vision AI — prompt editable in the n8n dashboard without a code deploy, one familiar secret-pair pattern. The route treats n8n exactly like classify-vision does: 15-second hard timeout, strict answer checking, and any problem degrades silently.
- **The AI chooses *which* plants, never *how many*.** Quantities reuse the engine's existing "given this fixed set of plants, fill the area" maths (built for PROJ-7 editing) — no new arithmetic, and an LLM never does area maths (its known weakness, the engine's strength).
- **The AI only ever sees survivors.** The route sends Claude only the plants that already passed the sun/zone/fit filters, each with its traits (native, maintenance, mature size, soil). A plant that can't survive the site can't even be mentioned to the AI, let alone picked. The AI must also pick within the engine's species-count bounds for the site's area; anything else is rejected wholesale (no partial repair, per the spec).
- **Fallback is the absence of a feature, not an error state.** If the route says "no curation" — key not configured, n8n down, timeout, refusal, invalid answer — the browser simply runs today's engine. The user sees today's plan. Zero new failure modes on the Scan → Plan journey.
- **Rationale is written once and stored.** Re-opening a plan never calls the AI (cost + stability); editing never calls the AI; only Generate/Regenerate does — at most one AI call per (re)generation, by construction.

### Dependencies (packages)

**None.** The n8n path needs no new packages in the app — plain server-to-server calls like classify-vision. New environment variables only: `N8N_CURATE_WEBHOOK_URL` + `N8N_CURATE_SECRET` (documented in `.env.local.example`; set in Vercel and self-hosted n8n like the scan-vision pair). A workflow doc (`docs/n8n-plan-curation-workflow.md`) will describe the n8n side for import, mirroring the scan-vision doc.

### Resolved spec questions

- **Monthly-effort promise in the intro ("about 20 minutes a month"): NO for v1.** The catalogue stores maintenance only as low/medium/high buckets — there is no minutes-per-month data to derive an honest number from. The intro may make qualitative effort statements grounded in real data ("every pick here is low-maintenance"), never a fabricated number.
- **Extra rate limiting: not for v1.** One AI call per (re)generation, only via an authenticated route, is the cost control. Regenerate-spamming is bounded by the plan build round-trip itself; if it ever shows up in usage, a per-user cooldown can be added inside the route without touching anything else.

## Implementation Notes (/backend, 2026-07-08)

Built exactly to the Tech Design — one migration, one API route, one n8n workflow (doc + importable JSON), client-side curation glue, and the two rationale text blocks. Suite 337/337 green (+36 new tests), lint + typecheck + production build clean.

### What was built

**DB — `supabase/migrations/20260708100000_proj12_plan_rationale.sql`** *(⚠ apply via dashboard SQL Editor, per project convention — NOT yet applied)*
- `plans.rationale_intro text` + `plan_plants.rationale text`, both nullable with `char_length` checks (1–600 / 1–200). No RLS changes — the columns ride the existing owner-only policies. NULL everywhere ≙ exactly today's plan (fallback + historical plans free).

**Pure validation core — `src/lib/plan-curation.ts`** (+ co-located test, 15 tests)
- `CURATION_INTRO_MAX` (600) / `CURATION_WHY_MAX` (200); `curationResultSchema` (Zod, length caps).
- `curationCandidates()` — hard-filter survivors *minus layer-ineligible plants* (the AI can't put a tree on a 10 m² site; layer eligibility isn't covered by the survival guardrail, so it's enforced at the menu).
- `selectionBounds()` / `selectionProblem()` — engine richness bounds + ids-⊆-menu + no-duplicates, shared by route and client so the two independent checks can't drift.
- `applyCuration()` — turns a validated AI answer into a `GeneratedPlan` (engine output shape): quantities via the existing `computeQuantities` maths, survival re-checked via `findConstraintViolations` (deliberately not the same code as `matchingSurvivors`), lines ordered by layer. Returns `null` on ANY problem → caller falls back. No partial repair.

**API route — `src/app/api/curate-plan/route.ts`** (+ co-located test, 15 tests)
- `requireUser()` + Zod body (`scan_id`); RLS-scoped loads (foreign scan → 404).
- Re-derives the survivor menu **server-side** — never accepts one from the browser; survivors-only payload to n8n (a non-survivor is never even mentioned to the model).
- Mirrors `/api/classify-vision`: `x-sproutly-secret` header, **15s hard timeout**, strict response validation (schema caps + `selectionProblem`), silent `{ curated: false }` on every failure (missing env, n8n down, refusal, off-schema, invalid selection) — always HTTP 200 for AI-path outcomes.

**Client glue — `src/lib/plans-client.ts`** (+ 6 new tests)
- `requestCuration()` — never throws; 20s client-side abort; re-validates the route's answer with the same Zod schema.
- `persistGeneratedPlan()` — runs the rule engine first, skips curation entirely on an empty plan, otherwise upgrades to the curated composition only when `applyCuration` independently re-passes it (guardrail + bounds). Persists `rationale_intro` / per-line `rationale` (NULL on fallback). Both callers (PlanBuilder auto-build + Generate/Regenerate button) get curation with no call-site changes.
- `replacePlanLines` / `PlanLineInput` now carry `rationale` — **a manual edit can no longer wipe a curated plan's "why" lines** (the editor's save path rewrites all rows).

**UI — two text blocks, no new components**
- `plan-editor.tsx`: "Why this plan" intro card (rendered only when `rationale_intro` exists — its presence IS the curated signal) + the "AI-assisted and survival-checked" disclosure line; per-plant "why" line on lines with a rationale. Both plain-text renders. User-added plants get `rationale: null` → never a fabricated why.
- `plan-builder.tsx`: interstitial copy → "Crafting your plan…" (same screen for AI and fallback paths, so a fallback looks exactly like today).

**n8n — `docs/n8n-plan-curation-workflow.md` + `docs/n8n/plan-curation.workflow.json`**
- Webhook (header auth) → Claude (`claude-sonnet-4-6`, JSON-locked prompt: menu-ids only, bounds, no invented numbers, no climate moralizing) → Code validation → Switch → Respond `ok` / `no_curation`. Mirrors the scan-vision workflow's conventions and import path.

### Deviations from spec
None functional. Length caps set to 600 (intro) / 200 (why) — the design left the numbers open; enforced at all three layers.

### Fix found during local verification (2026-07-09) — PlanBuilder StrictMode hang (pre-existing, PROJ-7 component)
Testing the flow locally in dev, the "Crafting your plan…" interstitial hung forever whenever enrichment was still pending at page load. Cause: `plan-builder.tsx` guarded the whole **effect** with a `startedRef` — under React StrictMode (dev only) the effect runs mount → cleanup → mount, so the cleanup cleared the 12s fallback timer + realtime subscription and the second mount early-returned, leaving nothing to ever trigger the build. Production (no StrictMode) was unaffected, which is why this never surfaced live. Fix: guard the **build** (a `builtRef` that survives the double-mount) and let the setup re-register on every effect run. Co-located `plan-builder.test.tsx` added (4 tests, rendered under `<StrictMode>` on purpose; the timeout test fails against the old code). Suite 341/341 green.

### Live smoke-test — PASSED (2026-07-09, local dev against production Supabase + n8n)
End-to-end verified: real scan (60 m² sandy full-sun gravel front garden) → "Crafting your plan…" → curated plan with the "Why this plan" intro card (references the actual conditions, evidence-forward, no invented numbers), disclosure line, and per-plant why-lines; quantities engine-computed. Three real-world issues found and fixed on the way, all on the n8n/ops side — **zero app-code changes needed** (the silent-fallback design delivered a plan through every one of them):
1. **n8n Prompt field must be in *Expression* mode** — imported as "Fixed", the `{{ JSON.stringify(...) }}` payload placeholder went to Claude literally; it answered with a clarifying question → `no_curation` on every run. Export JSON fixed (leading `=`), gotcha documented in the workflow doc. Same latent issue found + fixed in the scan-vision export (its postcode hint was never substituted; harmless).
2. **Editor autosave ≠ published version** — the Expression fix only took effect for the production webhook after an explicit Save; editor test runs (flask icon) had masked this by using the draft.
3. **`claude-sonnet-4-6` exceeded the 15s route timeout** (~17s with a real ~40-plant menu) → AbortError → fallback on every run. Switched the workflow model to **`claude-haiku-4-5`** (a few seconds, good one-liner quality); export JSON + doc updated. If the model is ever upgraded, `N8N_TIMEOUT_MS` (route) and the client guard must be raised to match.

### Remaining deploy gates (production only — local is fully working)
1. **Vercel env vars:** `N8N_CURATE_WEBHOOK_URL` + `N8N_CURATE_SECRET` (optional; unset = rule-engine-only, no user-visible difference).
2. **`.env.local.example`:** add the two placeholder lines (writes to env files were blocked by local permission settings this session — add by hand).
3. Migration already applied (2026-07-09); n8n workflow imported, fixed, Active.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
