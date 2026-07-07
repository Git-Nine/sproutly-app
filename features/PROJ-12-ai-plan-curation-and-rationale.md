# PROJ-12: AI Plan Curation & Rationale

## Status: Planned
**Created:** 2026-07-07
**Last Updated:** 2026-07-07

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
- [ ] Should the plan-level intro also state the estimated total monthly effort ("about 20 minutes a month")? Powerful for both personas, but only honest if derivable from maintenance levels — verify data supports it before promising it in copy. (Decide in /architecture or /refine.)
- [ ] German-language rationale: PRD is Germany-first but the UI is English today. When the product localizes, rationale generation must follow — flagging so localization scope includes AI copy.
- [ ] Does AI curation need a per-user rate limit beyond "one call per (re)generation" (e.g. regenerate-spamming)? Likely fine for v1 traffic; /architecture should confirm.

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

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
