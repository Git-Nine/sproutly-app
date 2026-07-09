-- PROJ-12: AI Plan Curation & Rationale — two nullable text columns, nothing else.
--
-- `plans.rationale_intro` holds the 2–3 sentence plan-level explanation; its
-- presence is ALSO the "this plan was AI-curated" signal (no separate flag).
-- `plan_plants.rationale` holds the one-line "why this one" per AI-picked line;
-- user-added plants and fallback/historical lines simply have NULL, so the
-- "no fabricated why" rules fall out of the data shape.
--
-- Length caps are enforced in three layers (AI answer format, route Zod
-- validation, and these DB checks) — keep the numbers in lockstep with
-- CURATION_INTRO_MAX / CURATION_WHY_MAX in src/lib/plan-curation.ts.
--
-- No RLS changes: both columns ride the existing owner-only policies on
-- plans / plan_plants (20260622100100_proj6_plans.sql).

alter table public.plans
  add column rationale_intro text
    check (rationale_intro is null or char_length(rationale_intro) between 1 and 600);

comment on column public.plans.rationale_intro is
  'PROJ-12: AI plan-level rationale (2–3 sentences). NULL = not AI-curated (fallback or historical plan).';

alter table public.plan_plants
  add column rationale text
    check (rationale is null or char_length(rationale) between 1 and 200);

comment on column public.plan_plants.rationale is
  'PROJ-12: one-line AI "why this one". NULL for user-added plants and fallback/historical lines.';
