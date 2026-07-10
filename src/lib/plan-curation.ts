import { z } from 'zod'
import { LAYER_DISPLAY_ORDER, type Plant } from '@/lib/plants'
import {
  RICHNESS_FLOOR,
  computeQuantities,
  findConstraintViolations,
  layerEligible,
  matchingSurvivors,
  richnessForArea,
  siteLocationBasis,
  siteRainfall,
  siteSoil,
  siteZone,
  type GeneratePlanInput,
  type GeneratedLine,
  type GeneratedPlan,
  type PlanSnapshot,
} from '@/lib/plan-engine'

/**
 * PROJ-12 — AI plan curation, the PURE half.
 *
 * The AI (behind /api/curate-plan → n8n) only ever chooses WHICH plants, from the
 * engine's hard-filter survivors, and writes the rationale text. Everything that
 * decides whether that answer is trustworthy — and how it becomes a plan — lives
 * here, dependency-free, so the API route (server) and the persist path (client)
 * validate with the SAME code yet run independently: a tampered client can't skip
 * the server's check, and a buggy server response can't skip the client's.
 *
 * Any validation failure yields null → the caller falls back to the pure
 * rule-engine plan (the spec's "full fallback, no partial repair").
 */

// ─── Length caps (lockstep with the DB checks in 20260708100000_proj12_plan_rationale.sql
//     and the n8n answer format in docs/n8n-plan-curation-workflow.md) ─────────
export const CURATION_INTRO_MAX = 600
export const CURATION_WHY_MAX = 200

/** One AI pick: a survivor's id + its one-line "why this one". */
export const curationSelectionSchema = z.object({
  plant_id: z.string().uuid(),
  why: z.string().trim().min(1).max(CURATION_WHY_MAX),
})

/** The curation payload as the route returns it to the browser (when curated). */
export const curationResultSchema = z.object({
  intro: z.string().trim().min(1).max(CURATION_INTRO_MAX),
  selection: z.array(curationSelectionSchema).min(1),
})

export type CurationResult = z.infer<typeof curationResultSchema>

/**
 * The survivor pool the AI is allowed to pick from: hard-filter survivors whose
 * LAYER is offered for this area (the engine never plans a tree onto a balcony,
 * so the AI must not be able to either — layer eligibility isn't covered by the
 * survival guardrail, which checks sun/zone/fit only).
 */
export function curationCandidates(
  input: Pick<GeneratePlanInput, 'scan' | 'enrichment' | 'catalogue'>,
): Plant[] {
  return matchingSurvivors(input).filter((p) => layerEligible(p.plant_type, input.scan.area_sqm))
}

/**
 * How many species the AI must pick — the engine's richness bounds for the area,
 * capped by what's actually available (a 4-survivor site can't demand 4+ picks
 * of a 3-plant pool).
 */
export function selectionBounds(
  areaSqm: number,
  candidateCount: number,
): { min: number; max: number } {
  const max = Math.min(richnessForArea(areaSqm), candidateCount)
  const min = Math.min(RICHNESS_FLOOR, max)
  return { min, max }
}

/**
 * Structural validation of an AI selection against the candidate pool: every id
 * must be a candidate, no duplicates, count within the richness bounds for the
 * site's area. Returns null when valid, or a short reason (for server-side
 * logging) when not. Shared by the route and applyCuration so the two
 * independent checks can't drift.
 */
export function selectionProblem(
  candidates: Plant[],
  areaSqm: number,
  curation: CurationResult,
): string | null {
  const allowed = new Set(candidates.map((p) => p.id))
  const seen = new Set<string>()
  for (const pick of curation.selection) {
    if (!allowed.has(pick.plant_id)) return `plant ${pick.plant_id} is not a curation candidate`
    if (seen.has(pick.plant_id)) return `plant ${pick.plant_id} picked twice`
    seen.add(pick.plant_id)
  }
  const bounds = selectionBounds(areaSqm, candidates.length)
  if (curation.selection.length < bounds.min || curation.selection.length > bounds.max) {
    return `selection of ${curation.selection.length} is outside the richness bounds ${bounds.min}–${bounds.max}`
  }
  return null
}

/**
 * Turn a validated AI curation into a plan in the engine's own output shape —
 * or return null (→ caller falls back to the rule engine) when ANYTHING about
 * it is off. Checks, in order:
 *
 *  1. every picked id is a curation candidate (hard-filter survivor in an
 *     eligible layer), no duplicates;
 *  2. the pick count sits within the engine's richness bounds for the area;
 *  3. the assembled plants pass the PROJ-6 survival guardrail
 *     (findConstraintViolations — independent of matchingSurvivors by design).
 *
 * Quantities/densities come from the existing computeQuantities maths (the
 * PROJ-7 rebalance path) — the AI never does area arithmetic. Lines are ordered
 * by layer (tallest first, like generation), keeping the AI's order within a layer.
 */
export function applyCuration(
  input: GeneratePlanInput,
  curation: CurationResult,
): GeneratedPlan | null {
  const { scan, enrichment, maintenancePreference } = input

  const candidates = curationCandidates(input)
  const byId = new Map(candidates.map((p) => [p.id, p]))

  // 1.+2. IDs (candidates only, no duplicates) and count (richness bounds).
  if (selectionProblem(candidates, scan.area_sqm, curation) !== null) return null

  const chosen = curation.selection.map((pick) => ({
    plant: byId.get(pick.plant_id)!,
    why: pick.why,
  }))

  // 3. Survival guardrail — deliberately NOT the same code as matchingSurvivors.
  const zone = siteZone(enrichment)
  const violations = findConstraintViolations({
    plants: chosen.map((c) => c.plant),
    sun: scan.sun_exposure,
    zone,
    areaSqm: scan.area_sqm,
  })
  if (violations.length > 0) return null

  // Quantities via the existing engine maths (nothing pinned on a fresh plan).
  const quantities = computeQuantities({
    plants: chosen.map((c) => c.plant),
    areaSqm: scan.area_sqm,
    surface: scan.surface,
    pinned: {},
  })

  const soil = siteSoil(enrichment)
  const snapshot: PlanSnapshot = {
    sun: scan.sun_exposure,
    area_sqm: scan.area_sqm,
    surface: scan.surface,
    space_type: scan.space_type,
    soil,
    zone,
    maintenance: maintenancePreference,
    rainfall_mm: siteRainfall(enrichment),
    location_basis: siteLocationBasis(enrichment),
  }

  // Layer order like generation (tallest first); AI's order kept within a layer.
  const lines: GeneratedLine[] = []
  let sortOrder = 0
  for (const layer of LAYER_DISPLAY_ORDER) {
    for (const { plant, why } of chosen) {
      if (plant.plant_type !== layer) continue
      lines.push({
        plant,
        layer,
        quantity: quantities[plant.id],
        soilFlag: soil !== null && !plant.soil_compatibility.includes(soil),
        reasons: {
          native: plant.native,
          maintenanceMatch:
            maintenancePreference !== null && plant.maintenance_level === maintenancePreference,
        },
        sortOrder: sortOrder++,
        rationale: why,
      })
    }
  }

  return {
    lines,
    extraMatchCount: candidates.length - lines.length,
    zoneUnconfirmed: zone === null,
    prepNote: scan.surface === 'gravel' || scan.surface === 'paved',
    isEmpty: false,
    snapshot,
    rationaleIntro: curation.intro,
  }
}
