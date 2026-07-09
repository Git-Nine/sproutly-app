import { describe, it, expect } from 'vitest'
import {
  CURATION_INTRO_MAX,
  CURATION_WHY_MAX,
  applyCuration,
  curationCandidates,
  curationResultSchema,
  selectionBounds,
  selectionProblem,
} from './plan-curation'
import {
  RICHNESS_FLOOR,
  findConstraintViolations,
  richnessForArea,
  siteZone,
  type GeneratePlanInput,
} from './plan-engine'
import type { Plant } from './plants'
import type { ScanEnrichment } from './scans'

/**
 * PROJ-12 — the trust boundary between the AI's answer and a persisted plan.
 * Every rejection path here IS the spec's "full fallback": applyCuration → null
 * means the caller persists the pure rule-engine plan.
 */

let id = 0
function plant(overrides: Partial<Plant> = {}): Plant {
  id += 1
  return {
    id: `p${id}`,
    common_name: `Plant ${id}`,
    latin_name: `Plantus ${id}`,
    sun_tolerance: ['full', 'partial', 'shade'],
    soil_compatibility: ['sand', 'loam', 'clay', 'silt', 'peat'],
    min_hardiness_zone: 4,
    mature_height_cm: 40,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    image_url: null,
    care_notes: null,
    created_at: '2026-01-01',
    updated_at: null,
    ...overrides,
  }
}

const enrichment = (over: Partial<ScanEnrichment> = {}): GeneratePlanInput['enrichment'] =>
  ({
    soil_type: 'loam',
    soil_status: 'success',
    hardiness_zone: '7',
    zone_status: 'success',
    ...over,
  }) as GeneratePlanInput['enrichment']

const scan = (over: Partial<GeneratePlanInput['scan']> = {}): GeneratePlanInput['scan'] => ({
  sun_exposure: 'full',
  area_sqm: 20,
  surface: 'soil',
  space_type: 'back_garden',
  ...over,
})

function input(over: Partial<GeneratePlanInput> = {}): GeneratePlanInput {
  return {
    scan: scan(),
    enrichment: enrichment(),
    catalogue: [],
    maintenancePreference: null,
    ...over,
  }
}

/** A pool of N interchangeable full-sun perennials that all survive the site. */
function pool(n: number): Plant[] {
  return Array.from({ length: n }, () => plant())
}

function selectionOf(plants: Plant[], why = 'Thrives in your sunny, loamy bed.') {
  return { intro: 'A calm, low-effort mix for your space.', selection: plants.map((p) => ({ plant_id: p.id, why })) }
}

describe('curationCandidates', () => {
  it('offers only hard-filter survivors', () => {
    const fits = plant()
    const wrongSun = plant({ sun_tolerance: ['shade'] })
    const tooTender = plant({ min_hardiness_zone: 9 })
    const candidates = curationCandidates({
      scan: scan(),
      enrichment: enrichment(),
      catalogue: [fits, wrongSun, tooTender],
    })
    expect(candidates.map((p) => p.id)).toEqual([fits.id])
  })

  it('excludes survivors whose layer is not offered for the area (no tree on 10 m²)', () => {
    const perennial = plant()
    const tree = plant({ plant_type: 'tree', mature_spread_cm: 100 }) // fits 10 m² physically
    const candidates = curationCandidates({
      scan: scan({ area_sqm: 10 }),
      enrichment: enrichment(),
      catalogue: [perennial, tree],
    })
    expect(candidates.map((p) => p.id)).toEqual([perennial.id])
  })
})

describe('selectionBounds', () => {
  it('spans the engine richness floor to the area richness, capped by availability', () => {
    expect(selectionBounds(20, 100)).toEqual({ min: RICHNESS_FLOOR, max: richnessForArea(20) })
    // Only 3 candidates → both bounds collapse to what's available.
    expect(selectionBounds(20, 3)).toEqual({ min: 3, max: 3 })
    expect(selectionBounds(20, 0)).toEqual({ min: 0, max: 0 })
  })
})

describe('selectionProblem', () => {
  const candidates = pool(6)
  const area = 20 // richnessForArea(20) = 6

  it('accepts a valid selection', () => {
    expect(selectionProblem(candidates, area, selectionOf(candidates.slice(0, 4)))).toBeNull()
  })

  it('rejects a plant outside the candidate pool (hallucinated id)', () => {
    const alien = plant()
    const sel = selectionOf([...candidates.slice(0, 3), alien])
    expect(selectionProblem(candidates, area, sel)).toMatch(/not a curation candidate/)
  })

  it('rejects duplicate picks', () => {
    const sel = selectionOf([candidates[0], candidates[1], candidates[2], candidates[0]])
    expect(selectionProblem(candidates, area, sel)).toMatch(/picked twice/)
  })

  it('rejects too few and too many picks (outside richness bounds)', () => {
    expect(selectionProblem(candidates, area, selectionOf(candidates.slice(0, 2)))).toMatch(/richness bounds/)
    const big = pool(20)
    expect(selectionProblem(big, area, selectionOf(big.slice(0, 10)))).toMatch(/richness bounds/)
  })
})

describe('applyCuration', () => {
  it('builds a plan in the engine output shape with rationale attached', () => {
    const candidates = pool(6)
    const picked = candidates.slice(0, 4)
    const inp = input({ catalogue: candidates })

    const curated = applyCuration(inp, selectionOf(picked, 'Low effort, fits your loam.'))

    expect(curated).not.toBeNull()
    expect(curated!.isEmpty).toBe(false)
    expect(curated!.rationaleIntro).toBe('A calm, low-effort mix for your space.')
    expect(curated!.lines.map((l) => l.plant.id).sort()).toEqual(picked.map((p) => p.id).sort())
    for (const line of curated!.lines) {
      expect(line.rationale).toBe('Low effort, fits your loam.')
      expect(line.quantity).toBeGreaterThanOrEqual(1)
    }
    // Snapshot mirrors the site — same contract the rule engine persists.
    expect(curated!.snapshot).toMatchObject({ sun: 'full', area_sqm: 20, soil: 'loam', zone: 7 })
    expect(curated!.extraMatchCount).toBe(2)
    // The curated plan itself passes the PROJ-6 survival guardrail.
    expect(
      findConstraintViolations({
        plants: curated!.lines.map((l) => l.plant),
        sun: inp.scan.sun_exposure,
        zone: siteZone(inp.enrichment),
        areaSqm: inp.scan.area_sqm,
      }),
    ).toEqual([])
  })

  it('orders lines by layer, tallest first, like generation', () => {
    const shrub = plant({ plant_type: 'shrub' })
    const others = pool(4)
    const inp = input({ catalogue: [shrub, ...others] })
    // AI answers with the shrub LAST — the plan must still lead with it.
    const curated = applyCuration(inp, selectionOf([...others.slice(0, 3), shrub]))
    expect(curated!.lines[0].plant.id).toBe(shrub.id)
    expect(curated!.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('returns null (→ full fallback) for a hallucinated plant id', () => {
    const candidates = pool(6)
    const alien = plant()
    const curated = applyCuration(
      input({ catalogue: candidates }),
      selectionOf([...candidates.slice(0, 3), alien]),
    )
    expect(curated).toBeNull()
  })

  it('returns null when the pick count is outside the richness bounds', () => {
    const candidates = pool(8)
    expect(
      applyCuration(input({ catalogue: candidates }), selectionOf(candidates.slice(0, 2))),
    ).toBeNull()
  })

  it('computes quantities with the engine maths (AI never does area arithmetic)', () => {
    const candidates = pool(6)
    const picked = candidates.slice(0, 4)
    const curated = applyCuration(input({ catalogue: candidates }), selectionOf(picked))
    // 4 identical perennials share the whole 20 m² → identical, engine-derived quantities.
    const quantities = curated!.lines.map((l) => l.quantity)
    expect(new Set(quantities).size).toBe(1)
    // 20 m² / 4 plants at 0.16 m² footprint ≈ 31 each — from computeQuantities, not the AI.
    expect(quantities[0]).toBe(Math.max(1, Math.round(20 / 4 / 0.16)))
  })
})

describe('curationResultSchema (length caps — the route layer of the 3-layer cap)', () => {
  const uuid = 'aaaaaaaa-0000-4000-a000-000000000001'

  it('accepts text within the caps', () => {
    const ok = curationResultSchema.safeParse({
      intro: 'a'.repeat(CURATION_INTRO_MAX),
      selection: [{ plant_id: uuid, why: 'b'.repeat(CURATION_WHY_MAX) }],
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an over-long intro or why (never truncated into the UI)', () => {
    expect(
      curationResultSchema.safeParse({
        intro: 'a'.repeat(CURATION_INTRO_MAX + 1),
        selection: [{ plant_id: uuid, why: 'fine' }],
      }).success,
    ).toBe(false)
    expect(
      curationResultSchema.safeParse({
        intro: 'fine',
        selection: [{ plant_id: uuid, why: 'b'.repeat(CURATION_WHY_MAX + 1) }],
      }).success,
    ).toBe(false)
  })

  it('rejects empty text and an empty selection', () => {
    expect(
      curationResultSchema.safeParse({ intro: '  ', selection: [{ plant_id: uuid, why: 'x' }] })
        .success,
    ).toBe(false)
    expect(curationResultSchema.safeParse({ intro: 'fine', selection: [] }).success).toBe(false)
  })
})
