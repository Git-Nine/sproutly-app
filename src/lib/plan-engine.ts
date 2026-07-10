import { LAYER_DISPLAY_ORDER } from '@/lib/plants'
import type { Plant, PlantType, MaintenanceLevel, Soil } from '@/lib/plants'
import type { Scan, ScanEnrichment, SunExposure, Surface, SpaceType } from '@/lib/scans'
import { BAND_RANK, plantConfidence, type ConfidenceSite, type LocationBasis } from '@/lib/plan-confidence'

/**
 * PROJ-6 rule engine — a PURE, deterministic calculation.
 *
 * Same inputs (scan + enrichment + catalogue + maintenance preference) always
 * produce the same plan, so results are trustworthy and unit-testable, and PROJ-7
 * reuses this exact module for its interactive editing. No I/O, no Date/random.
 *
 * Pipeline: hard filters (sun, winter zone, physical fit) → eligible layers by
 * area (~60/30/10) → area-scaled richness target → band-led ranking within each
 * layer (PROJ-13 confidence band first, then the original native → soil →
 * maintenance → compact → name order as tiebreak) → quantities that fill each
 * layer's area at mature spread. The band is RANKING-ONLY: the hard filter set
 * is untouched, so no plant is excluded (or admitted) by PROJ-13.
 */

// ---- Tunable constants (see spec "Engine constants") ----
/** Layers need a minimum area before they're offered (no trees on a balcony). */
export const SHRUB_MIN_AREA_SQM = 4
export const TREE_MIN_AREA_SQM = 15
/** Species richness scales with area between these bounds. */
export const RICHNESS_FLOOR = 4
export const RICHNESS_CEILING = 12
/** Area (m²) at which richness == floor; ~+1 species per doubling above this. */
export const RICHNESS_AREA_BASE = 3
/** Paved/gravel → plant about half as densely (feature/container style). */
export const PAVED_DENSITY_FACTOR = 0.5
/** Upper bound on total plants in a plan. */
export const TOTAL_QUANTITY_CAP = 200
/** Area-allocation weights per layer (groundcover+perennial = 60, shrub 30, tree 10). */
const LAYER_WEIGHT: Record<PlantType, number> = {
  groundcover: 30,
  perennial: 30,
  shrub: 30,
  tree: 10,
}

export type PlanReasons = { native: boolean; maintenanceMatch: boolean }

export type GeneratedLine = {
  plant: Plant
  layer: PlantType
  quantity: number
  soilFlag: boolean
  reasons: PlanReasons
  sortOrder: number
  /** PROJ-12: one-line AI "why this one". Absent on pure rule-engine lines. */
  rationale?: string
}

export type PlanSnapshot = {
  sun: SunExposure
  area_sqm: number
  surface: Surface
  space_type: SpaceType
  soil: Soil | null
  zone: number | null
  maintenance: MaintenanceLevel | null
  /** PROJ-13: raw annual rainfall (mm) at generation time; null = climate unavailable. */
  rainfall_mm: number | null
  /** PROJ-13: how the site location was derived; null = unknown (e.g. no enrichment). */
  location_basis: LocationBasis | null
}

export type GeneratedPlan = {
  lines: GeneratedLine[]
  extraMatchCount: number
  zoneUnconfirmed: boolean
  prepNote: boolean
  isEmpty: boolean
  snapshot: PlanSnapshot
  /** PROJ-12: AI plan-level rationale (2–3 sentences). Absent on pure rule-engine plans. */
  rationaleIntro?: string
}

export type GeneratePlanInput = {
  scan: Pick<Scan, 'sun_exposure' | 'area_sqm' | 'surface' | 'space_type'>
  enrichment: Pick<
    ScanEnrichment,
    | 'soil_type'
    | 'soil_status'
    | 'hardiness_zone'
    | 'zone_status'
    // PROJ-13 band inputs — nullable/optional-friendly, so callers that predate
    // them (or tests with partial fixtures) keep working: absent = skipped factor.
    | 'rainfall_mm'
    | 'climate_status'
    | 'location_basis'
  > | null
  catalogue: Plant[]
  maintenancePreference: MaintenanceLevel | null
}

/** Mature footprint in m² (plants just touch at maturity). */
export function footprintSqm(plant: Pick<Plant, 'mature_spread_cm'>): number {
  const m = plant.mature_spread_cm / 100
  return m * m
}

// ─── Quantity maths shared by generation AND the PROJ-7 rebalance ────────────
// One implementation for density, per-layer area, per-plant quantity and the
// global cap, so the two paths cannot drift apart ("same per-layer footprint
// maths as generation" is enforced by construction, not by hand).

/** Density factor for a surface — paved/gravel plans plant about half as densely. */
function densityFor(surface: Surface): number {
  return surface === 'gravel' || surface === 'paved' ? PAVED_DENSITY_FACTOR : 1
}

/** One layer's share of the site area, weighted across the layers present. */
function layerAreaSqm(areaSqm: number, layer: PlantType, presentLayers: PlantType[]): number {
  const totalWeight = presentLayers.reduce((s, l) => s + LAYER_WEIGHT[l], 0) || 1
  return (areaSqm * LAYER_WEIGHT[layer]) / totalWeight
}

/** The quantity that fills `perArea` m² at the plant's mature spread (≥ 1). */
function quantityFor(
  plant: Pick<Plant, 'mature_spread_cm'>,
  perArea: number,
  density: number,
): number {
  return Math.max(1, Math.round((perArea / footprintSqm(plant)) * density))
}

/**
 * Cap the summed quantities at `cap`: scale DOWN only the adjustable entries
 * (each stays ≥ 1), then decrement the largest adjustable entry until the total
 * fits. Fixed entries (the user's pinned choices) are never changed. Returns
 * the capped quantities in input order.
 */
function capQuantities(
  entries: { quantity: number; adjustable: boolean }[],
  cap: number,
): number[] {
  const result = entries.map((e) => e.quantity)
  let total = result.reduce((s, q) => s + q, 0)
  if (total <= cap) return result

  const fixedTotal = entries.reduce((s, e) => (e.adjustable ? s : s + e.quantity), 0)
  const budget = Math.max(0, cap - fixedTotal)
  const adjustableTotal = total - fixedTotal
  if (adjustableTotal > budget && adjustableTotal > 0) {
    const factor = budget / adjustableTotal
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].adjustable) result[i] = Math.max(1, Math.floor(result[i] * factor))
    }
  }

  total = result.reduce((s, q) => s + q, 0)
  let guard = 0
  while (total > cap && guard++ < 100000) {
    let largest = -1
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].adjustable) continue
      if (result[i] > 1 && (largest === -1 || result[i] > result[largest])) largest = i
    }
    if (largest === -1) break
    result[largest] -= 1
    total -= 1
  }
  return result
}

/** Target species richness for a given area — floor..ceiling, ~+1 per doubling. */
export function richnessForArea(areaSqm: number): number {
  const raw =
    RICHNESS_FLOOR + Math.floor(Math.log2(Math.max(areaSqm, RICHNESS_AREA_BASE) / RICHNESS_AREA_BASE))
  return Math.min(RICHNESS_CEILING, Math.max(RICHNESS_FLOOR, raw))
}

// Each site-fact helper picks only the fields it reads, so callers holding a
// narrower enrichment slice (e.g. isPlanStale) keep compiling as new band
// inputs are added to GeneratePlanInput.

/** The site's soil bucket from enrichment, or null when not successfully derived. */
export function siteSoil(
  enrichment: Pick<ScanEnrichment, 'soil_type' | 'soil_status'> | null,
): Soil | null {
  return enrichment && enrichment.soil_status === 'success' ? enrichment.soil_type : null
}

/** The site's whole-number hardiness zone from enrichment, or null when unconfirmed. */
export function siteZone(
  enrichment: Pick<ScanEnrichment, 'hardiness_zone' | 'zone_status'> | null,
): number | null {
  const parsed =
    enrichment && enrichment.zone_status === 'success' && enrichment.hardiness_zone != null
      ? Number.parseInt(enrichment.hardiness_zone, 10)
      : NaN
  return Number.isNaN(parsed) ? null : parsed
}

/** The site's raw annual rainfall (mm) from enrichment, or null when climate wasn't derived. */
export function siteRainfall(
  enrichment: Pick<ScanEnrichment, 'rainfall_mm' | 'climate_status'> | null,
): number | null {
  return enrichment && enrichment.climate_status === 'success' ? (enrichment.rainfall_mm ?? null) : null
}

/** How the site location was derived (GPS vs postcode centroid), or null when unknown. */
export function siteLocationBasis(
  enrichment: Pick<ScanEnrichment, 'location_basis'> | null,
): LocationBasis | null {
  return enrichment?.location_basis ?? null
}

/**
 * PROJ-13: the confidence module's site input, derived from a plan snapshot.
 * Kept next to the snapshot type so the two can't drift; the UI builds the same
 * value from a persisted `plans` row via `confidenceSiteFromPlan` (plans.ts).
 */
export function confidenceSiteFromSnapshot(snapshot: PlanSnapshot): ConfidenceSite {
  return {
    soil: snapshot.soil,
    zone: snapshot.zone,
    rainfallMm: snapshot.rainfall_mm,
    locationBasis: snapshot.location_basis,
    maintenance: snapshot.maintenance,
  }
}

/**
 * The plants that pass the site's HARD filters (sun, winter zone, physical fit) —
 * the pool PROJ-6 builds a plan from and PROJ-7 offers as "more plants that suit
 * your space." Shared by generation and editing so both use one filter.
 */
export function matchingSurvivors(
  input: Pick<GeneratePlanInput, 'scan' | 'enrichment' | 'catalogue'>,
): Plant[] {
  const { scan, enrichment, catalogue } = input
  const zone = siteZone(enrichment)
  const area = scan.area_sqm
  return catalogue.filter(
    (p) =>
      p.sun_tolerance.includes(scan.sun_exposure) &&
      (zone === null || zone >= p.min_hardiness_zone) &&
      footprintSqm(p) <= area,
  )
}

/** A recommended plant that should never have been recommended for this site. */
export type ConstraintViolation = {
  plantId: string
  commonName: string
  /** Which hard survival constraint(s) the recommendation breaks. */
  reasons: ('sun' | 'zone' | 'fit')[]
}

/** The fields the guardrail needs from each plant under review. */
type PlantSurvivalFields = Pick<
  Plant,
  'id' | 'common_name' | 'sun_tolerance' | 'min_hardiness_zone' | 'mature_spread_cm'
>

/**
 * GUARDRAIL (PROJ-6): independently re-derive whether every plant in a plan truly
 * clears the site's HARD survival constraints — sun, winter zone (when known),
 * and physical fit. This deliberately does NOT call `matchingSurvivors`, so a
 * regression in the selection pipeline (or a bad catalogue row) can't hide behind
 * the same code that produced the plan.
 *
 * Takes the plants plus the three site values directly (rather than a full
 * `GeneratedPlan`) so it checks BOTH a freshly generated plan and a persisted one
 * read back from the database — `zone` is the resolved `siteZone(enrichment)`, or
 * `null` when unconfirmed (the zone filter is then skipped, matching generation).
 *
 * A clean plan returns `[]`. A non-empty result means a plant that could die in
 * this space slipped into the recommendation — what this guardrail exists to
 * catch. The CI test asserts this is empty across the seed catalogue; the plan
 * view logs it as a dev-only assertion.
 */
export function findConstraintViolations(input: {
  plants: PlantSurvivalFields[]
  sun: SunExposure
  zone: number | null
  areaSqm: number
}): ConstraintViolation[] {
  const { plants, sun, zone, areaSqm } = input
  const violations: ConstraintViolation[] = []
  for (const plant of plants) {
    const reasons: ConstraintViolation['reasons'] = []
    if (!plant.sun_tolerance.includes(sun)) reasons.push('sun')
    if (zone !== null && zone < plant.min_hardiness_zone) reasons.push('zone')
    if (footprintSqm(plant) > areaSqm) reasons.push('fit')
    if (reasons.length > 0) {
      violations.push({ plantId: plant.id, commonName: plant.common_name, reasons })
    }
  }
  return violations
}

/**
 * PROJ-7 rebalance: given a FIXED set of plants (the user's edited selection) and a
 * map of pinned plant_id → quantity, compute every plant's quantity. Pinned plants
 * keep their value; un-pinned plants re-fill the area their layer's pinned plants
 * don't claim, using the same per-layer footprint maths as generation. Returns a
 * plant_id → quantity map. Pure.
 */
export function computeQuantities(input: {
  plants: Pick<Plant, 'id' | 'plant_type' | 'mature_spread_cm'>[]
  areaSqm: number
  surface: Surface
  pinned: Record<string, number>
}): Record<string, number> {
  const { plants, areaSqm, surface, pinned } = input
  const density = densityFor(surface)
  const present = LAYER_DISPLAY_ORDER.filter((l) => plants.some((p) => p.plant_type === l))

  const result: Record<string, number> = {}
  for (const layer of present) {
    const inLayer = plants.filter((p) => p.plant_type === layer)
    const layerArea = layerAreaSqm(areaSqm, layer, present)
    const pinnedInLayer = inLayer.filter((p) => pinned[p.id] != null)
    const unpinnedInLayer = inLayer.filter((p) => pinned[p.id] == null)
    const pinnedClaim = pinnedInLayer.reduce((s, p) => s + pinned[p.id] * footprintSqm(p), 0)
    const remaining = Math.max(0, layerArea - pinnedClaim)
    const perArea = unpinnedInLayer.length ? remaining / unpinnedInLayer.length : 0
    for (const p of pinnedInLayer) result[p.id] = Math.max(1, Math.round(pinned[p.id]))
    for (const p of unpinnedInLayer) result[p.id] = quantityFor(p, perArea, density)
  }

  // Global cap — scale DOWN the un-pinned quantities only (pinned values are the
  // user's explicit choice and are preserved).
  const capped = capQuantities(
    plants.map((p) => ({ quantity: result[p.id], adjustable: pinned[p.id] == null })),
    TOTAL_QUANTITY_CAP,
  )
  plants.forEach((p, i) => {
    result[p.id] = capped[i]
  })
  return result
}

/** Whether a layer is offered at all for a site of this size (no trees on a balcony). */
export function layerEligible(layer: PlantType, areaSqm: number): boolean {
  if (layer === 'groundcover' || layer === 'perennial') return true
  if (layer === 'shrub') return areaSqm >= SHRUB_MIN_AREA_SQM
  return areaSqm >= TREE_MIN_AREA_SQM // tree
}

/**
 * Order a layer's survivors: confidence band (PROJ-13) → native → soil-match →
 * maintenance-match → compact (balcony) → name. The band is the FIRST key so the
 * plan visibly practices what the displayed band preaches; everything after it
 * is the original PROJ-6 order, now the tiebreak within a band.
 */
function rankLayer(
  plants: Plant[],
  site: ConfidenceSite,
  spaceType: SpaceType,
): Plant[] {
  const { soil, maintenance } = site
  const band = new Map(plants.map((p) => [p.id, BAND_RANK[plantConfidence(p, site).band]]))
  return [...plants].sort((a, b) => {
    const bandDiff = band.get(a.id)! - band.get(b.id)!
    if (bandDiff !== 0) return bandDiff
    if (a.native !== b.native) return a.native ? -1 : 1
    if (soil) {
      const am = a.soil_compatibility.includes(soil) ? 0 : 1
      const bm = b.soil_compatibility.includes(soil) ? 0 : 1
      if (am !== bm) return am - bm
    }
    if (maintenance) {
      const am = a.maintenance_level === maintenance ? 0 : 1
      const bm = b.maintenance_level === maintenance ? 0 : 1
      if (am !== bm) return am - bm
    }
    if (spaceType === 'balcony' && a.mature_spread_cm !== b.mature_spread_cm) {
      return a.mature_spread_cm - b.mature_spread_cm
    }
    return a.latin_name.localeCompare(b.latin_name)
  })
}

/** Distribute the richness target across the present layers (weighted, ≥1 each, capped by availability). */
function speciesSharePerLayer(
  presentLayers: PlantType[],
  byLayer: Map<PlantType, Plant[]>,
  richness: number,
): Map<PlantType, number> {
  const totalWeight = presentLayers.reduce((s, l) => s + LAYER_WEIGHT[l], 0)
  const share = new Map<PlantType, number>()
  for (const l of presentLayers) {
    const raw = Math.max(1, Math.round((richness * LAYER_WEIGHT[l]) / totalWeight))
    share.set(l, Math.min(raw, byLayer.get(l)!.length))
  }

  const avail = (l: PlantType) => byLayer.get(l)!.length
  const sum = () => presentLayers.reduce((s, l) => s + share.get(l)!, 0)
  const totalAvail = presentLayers.reduce((s, l) => s + avail(l), 0)
  const target = Math.min(richness, totalAvail)

  let guard = 0
  while (sum() < target && guard++ < 1000) {
    // add to the layer with the most remaining capacity (tiebreak: display order)
    let best: PlantType | null = null
    let bestRemaining = 0
    for (const l of LAYER_DISPLAY_ORDER) {
      if (!share.has(l)) continue
      const remaining = avail(l) - share.get(l)!
      if (remaining > bestRemaining) {
        best = l
        bestRemaining = remaining
      }
    }
    if (!best) break
    share.set(best, share.get(best)! + 1)
  }
  guard = 0
  while (sum() > target && guard++ < 1000) {
    // remove from the largest share above 1 (tiebreak: reverse display order)
    let best: PlantType | null = null
    for (let i = LAYER_DISPLAY_ORDER.length - 1; i >= 0; i--) {
      const l = LAYER_DISPLAY_ORDER[i]
      if (!share.has(l) || share.get(l)! <= 1) continue
      if (best === null || share.get(l)! > share.get(best)!) best = l
    }
    if (!best) break
    share.set(best, share.get(best)! - 1)
  }
  return share
}

export function generatePlan(input: GeneratePlanInput): GeneratedPlan {
  const { scan, enrichment, catalogue, maintenancePreference } = input

  const soil = siteSoil(enrichment)
  const zone = siteZone(enrichment)
  const zoneUnconfirmed = zone === null

  const area = scan.area_sqm
  const prepNote = scan.surface === 'gravel' || scan.surface === 'paved'
  const densityFactor = densityFor(scan.surface)

  const snapshot: PlanSnapshot = {
    sun: scan.sun_exposure,
    area_sqm: area,
    surface: scan.surface,
    space_type: scan.space_type,
    soil,
    zone,
    maintenance: maintenancePreference,
    rainfall_mm: siteRainfall(enrichment),
    location_basis: siteLocationBasis(enrichment),
  }
  const confidenceSite = confidenceSiteFromSnapshot(snapshot)

  // 1. Hard filters: sun, winter zone (when known), physical fit (shared helper).
  const survivors = matchingSurvivors({ scan, enrichment, catalogue })

  const empty = (): GeneratedPlan => ({
    lines: [],
    extraMatchCount: 0,
    zoneUnconfirmed,
    prepNote,
    isEmpty: true,
    snapshot,
  })

  if (survivors.length === 0) return empty()

  // 2. Eligible layers by area, survivors grouped + ranked within each.
  const byLayer = new Map<PlantType, Plant[]>()
  for (const layer of LAYER_DISPLAY_ORDER) {
    if (!layerEligible(layer, area)) continue
    const members = survivors.filter((p) => p.plant_type === layer)
    if (members.length) {
      byLayer.set(layer, rankLayer(members, confidenceSite, scan.space_type))
    }
  }
  const presentLayers = LAYER_DISPLAY_ORDER.filter((l) => byLayer.has(l))
  // All survivors fell into ineligible layers (e.g. only trees survive on a tiny plot).
  if (presentLayers.length === 0) return empty()

  // 3. Richness target + per-layer species share.
  const richness = richnessForArea(area)
  const share = speciesSharePerLayer(presentLayers, byLayer, richness)

  // 4./5. Choose species + compute quantities (area allocation per layer uses
  // the same weights as the species split — see layerAreaSqm).
  const lines: GeneratedLine[] = []
  let sortOrder = 0
  for (const layer of LAYER_DISPLAY_ORDER) {
    if (!byLayer.has(layer)) continue
    const chosen = byLayer.get(layer)!.slice(0, share.get(layer)!)
    if (chosen.length === 0) continue
    const layerArea = layerAreaSqm(area, layer, presentLayers)
    const perSpeciesArea = layerArea / chosen.length
    for (const plant of chosen) {
      const qty = quantityFor(plant, perSpeciesArea, densityFactor)
      lines.push({
        plant,
        layer,
        quantity: qty,
        soilFlag: soil !== null && !plant.soil_compatibility.includes(soil),
        reasons: {
          native: plant.native,
          maintenanceMatch:
            maintenancePreference !== null && plant.maintenance_level === maintenancePreference,
        },
        sortOrder: sortOrder++,
      })
    }
  }

  if (lines.length === 0) return empty()

  // 6. Global quantity cap (all generated lines are adjustable — nothing is pinned yet).
  const capped = capQuantities(
    lines.map((l) => ({ quantity: l.quantity, adjustable: true })),
    TOTAL_QUANTITY_CAP,
  )
  lines.forEach((l, i) => {
    l.quantity = capped[i]
  })

  return {
    lines,
    extraMatchCount: survivors.length - lines.length,
    zoneUnconfirmed,
    prepNote,
    isEmpty: false,
    snapshot,
  }
}
