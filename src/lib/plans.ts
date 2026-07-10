import type { Plant, MaintenanceLevel, Soil } from '@/lib/plants'
import type { Scan, ScanEnrichment, SunExposure, Surface, SpaceType } from '@/lib/scans'
import { siteSoil, siteZone } from '@/lib/plan-engine'
import type { ConfidenceSite, LocationBasis } from '@/lib/plan-confidence'

/**
 * Plan contract for PROJ-6 (Rule-Based Plan Generation).
 *
 * A scan has at most ONE plan (1:1). A plan stores a snapshot of the conditions it
 * was generated from (so the plan view is self-contained and PROJ-7 can detect
 * staleness) plus its lines in `plan_plants`. The rule engine that fills these
 * lives in `src/lib/plan-engine.ts`. The UI is built against this contract; reads
 * and writes error until the PROJ-6 backend migration creates the tables (same
 * staged flow as PROJ-2/3/4/5).
 */

export const PLANS_TABLE = 'plans'
export const PLAN_PLANTS_TABLE = 'plan_plants'

/** A row of public.plans as the UI reads it. */
export type Plan = {
  id: string
  scan_id: string
  user_id: string
  // Snapshot of the inputs the plan was generated from.
  snapshot_sun: SunExposure
  snapshot_area_sqm: number
  snapshot_surface: Surface
  snapshot_space_type: SpaceType
  snapshot_soil: Soil | null
  snapshot_zone: number | null
  snapshot_maintenance: MaintenanceLevel | null
  /** PROJ-13: raw annual rainfall (mm) at generation time. NULL = climate
   *  unavailable or pre-PROJ-13 plan — the moisture band factor is then skipped. */
  snapshot_rainfall_mm: number | null
  /** PROJ-13: how the site location was derived. NULL = unknown or pre-PROJ-13
   *  plan — the location band factor is then skipped. */
  snapshot_location_basis: LocationBasis | null
  // Plan-level flags / counts.
  zone_unconfirmed: boolean
  extra_match_count: number
  /** PROJ-12: AI plan-level rationale (2–3 sentences). NULL = not AI-curated
   *  (fallback or historical plan) — its presence is the "curated" signal. */
  rationale_intro: string | null
  created_at: string
  updated_at: string | null
}

/** A row of public.plan_plants — one chosen plant + its recommended quantity. */
export type PlanPlant = {
  id: string
  plan_id: string
  plant_id: string
  quantity: number
  sort_order: number
  /** Whether this plant may not suit the site's soil (computed at generation time). */
  soil_flag: boolean
  /** PROJ-7: the user hand-set this quantity → excluded from rebalancing. */
  pinned: boolean
  /** PROJ-12: one-line AI "why this one". NULL for user-added plants and
   *  fallback/historical lines — those never show a fabricated rationale. */
  rationale: string | null
  created_at: string
}

/** plan_plants joined with its plant — the shape the plan view reads. */
export type PlanPlantWithPlant = PlanPlant & { plants: Plant | null }

/** True when the scan's surface needs clearing/prep before planting (gravel/paved). */
export function needsPrep(surface: Surface): boolean {
  return surface === 'gravel' || surface === 'paved'
}

/**
 * PROJ-7: collapse lines for the same plant into one (summed quantity, pinned if any
 * were, earliest sort order). A PROJ-6 admin reassignment can leave a plan with the
 * same plant twice; the user must never see a duplicate. Pure.
 */
export function mergeDuplicateLines(lines: PlanPlantWithPlant[]): PlanPlantWithPlant[] {
  const byPlant = new Map<string, PlanPlantWithPlant>()
  for (const line of lines) {
    const existing = byPlant.get(line.plant_id)
    if (!existing) {
      byPlant.set(line.plant_id, { ...line })
    } else {
      existing.quantity += line.quantity
      existing.pinned = existing.pinned || line.pinned
      existing.soil_flag = existing.soil_flag || line.soil_flag
      existing.sort_order = Math.min(existing.sort_order, line.sort_order)
    }
  }
  return [...byPlant.values()].sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * PROJ-13: the confidence module's site input, read from a persisted plan row's
 * SNAPSHOT (never the live scan — consistent with how PROJ-7 keeps stale plans
 * honest). Nulls mean "not captured" and make the module skip those factors, so
 * pre-PROJ-13 plans get honest bands without any backfill. Pure.
 */
export function confidenceSiteFromPlan(
  plan: Pick<
    Plan,
    | 'snapshot_soil'
    | 'snapshot_zone'
    | 'snapshot_rainfall_mm'
    | 'snapshot_location_basis'
    | 'snapshot_maintenance'
  >,
): ConfidenceSite {
  return {
    soil: plan.snapshot_soil,
    zone: plan.snapshot_zone,
    rainfallMm: plan.snapshot_rainfall_mm,
    locationBasis: plan.snapshot_location_basis,
    maintenance: plan.snapshot_maintenance,
  }
}

/**
 * PROJ-7: a plan is stale when the scan's MATCHING inputs no longer equal the
 * snapshot the plan was generated from. Cosmetic scan fields (name, photo) are
 * ignored. Pure.
 *
 * PROJ-13's snapshot additions (rainfall, location basis) are DELIBERATELY not
 * staleness inputs: they feed banding/ranking only, never the survivor pool,
 * and including them would flag every pre-PROJ-13 plan stale (null vs
 * now-captured) the moment this feature ships.
 */
export function isPlanStale(
  plan: Plan,
  current: {
    scan: Pick<Scan, 'sun_exposure' | 'area_sqm' | 'surface' | 'space_type'>
    enrichment: Pick<ScanEnrichment, 'soil_type' | 'soil_status' | 'hardiness_zone' | 'zone_status'> | null
    maintenancePreference: MaintenanceLevel | null
  },
): boolean {
  const { scan, enrichment, maintenancePreference } = current
  return (
    plan.snapshot_sun !== scan.sun_exposure ||
    plan.snapshot_area_sqm !== scan.area_sqm ||
    plan.snapshot_surface !== scan.surface ||
    plan.snapshot_space_type !== scan.space_type ||
    plan.snapshot_soil !== siteSoil(enrichment) ||
    plan.snapshot_zone !== siteZone(enrichment) ||
    plan.snapshot_maintenance !== maintenancePreference
  )
}
