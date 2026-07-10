import { describe, it, expect } from 'vitest'
import {
  generatePlan,
  richnessForArea,
  footprintSqm,
  RICHNESS_FLOOR,
  RICHNESS_CEILING,
  TREE_MIN_AREA_SQM,
  type GeneratePlanInput,
} from './plan-engine'
import type { Plant } from './plants'
import type { ScanEnrichment } from './scans'

/**
 * PROJ-6 rule engine. These cover the spec's matching contract at the logic layer:
 * hard filters (sun/zone/fit), native-first-within-layer, soil flag, area-scaled
 * richness, small-area layer gating, the quantity cap, and determinism.
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

const enrichment = (over: Partial<ScanEnrichment> = {}): GeneratePlanInput['enrichment'] => ({
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

function run(over: Partial<GeneratePlanInput> = {}) {
  return generatePlan({
    scan: scan(),
    enrichment: enrichment(),
    catalogue: [],
    maintenancePreference: null,
    ...over,
  })
}

describe('richnessForArea', () => {
  it('clamps to the floor for tiny areas and the ceiling for huge ones', () => {
    expect(richnessForArea(1)).toBe(RICHNESS_FLOOR)
    expect(richnessForArea(3)).toBe(RICHNESS_FLOOR)
    expect(richnessForArea(100000)).toBe(RICHNESS_CEILING)
  })
  it('grows monotonically with area', () => {
    expect(richnessForArea(50)).toBeGreaterThanOrEqual(richnessForArea(10))
  })
})

describe('hard filters', () => {
  it('excludes plants whose sun tolerance excludes the site sun', () => {
    const r = run({
      scan: scan({ sun_exposure: 'shade' }),
      catalogue: [plant({ sun_tolerance: ['full'] }), plant({ sun_tolerance: ['shade'] })],
    })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].plant.sun_tolerance).toContain('shade')
  })

  it('excludes plants not hardy enough for the site winter zone', () => {
    const r = run({
      enrichment: enrichment({ hardiness_zone: '6' }),
      catalogue: [plant({ min_hardiness_zone: 7 }), plant({ min_hardiness_zone: 5 })],
    })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].plant.min_hardiness_zone).toBe(5)
  })

  it('skips the zone filter and flags zoneUnconfirmed when zone is unavailable', () => {
    const r = run({
      enrichment: enrichment({ hardiness_zone: null, zone_status: 'unavailable' }),
      catalogue: [plant({ min_hardiness_zone: 11 })],
    })
    expect(r.zoneUnconfirmed).toBe(true)
    expect(r.lines).toHaveLength(1) // not excluded on hardiness
  })

  it('excludes a plant too large to physically fit the area', () => {
    const r = run({
      scan: scan({ area_sqm: 4 }),
      catalogue: [plant({ mature_spread_cm: 500 })], // 25 m² footprint > 4 m²
    })
    expect(r.isEmpty).toBe(true)
  })
})

describe('native-first within a layer', () => {
  it('chooses only natives when more natives than the share exist', () => {
    // area 3 → richness floor (4); one perennial layer with 5 natives + 2 non-natives.
    const natives = Array.from({ length: 5 }, () => plant({ native: true }))
    const nonNatives = [plant({ native: false }), plant({ native: false })]
    const r = run({ scan: scan({ area_sqm: 3 }), catalogue: [...nonNatives, ...natives] })
    expect(r.lines.length).toBeGreaterThan(0)
    expect(r.lines.every((l) => l.plant.native)).toBe(true)
  })

  it('backfills non-natives only when natives cannot fill the share', () => {
    // 2 natives + 3 non-natives, richness 4 → 2 natives + 2 non-natives chosen.
    const natives = [plant({ native: true }), plant({ native: true })]
    const nonNatives = Array.from({ length: 3 }, () => plant({ native: false }))
    const r = run({ scan: scan({ area_sqm: 3 }), catalogue: [...natives, ...nonNatives] })
    expect(r.lines.some((l) => !l.plant.native)).toBe(true)
    // ...but natives are still preferred — every native present is chosen first.
    expect(r.lines.filter((l) => l.plant.native).length).toBe(2)
  })
})

describe('band-led ranking (PROJ-13)', () => {
  it('ranks a higher-band plant ahead of a lower-band one in the same layer — even a native', () => {
    // Native B has a moisture conflict (wet plant, low-rainfall site) → worth_checking.
    // Non-native A is clean → high. Band must beat the old native-first key.
    const a = plant({ native: false, moisture: 'moist', latin_name: 'Zeta zeta' })
    const b = plant({ native: true, moisture: 'wet', latin_name: 'Alpha alpha' })
    const r = run({
      scan: scan({ area_sqm: 3 }), // richness floor → only some picked; A must win
      enrichment: enrichment({ rainfall_mm: 500, climate_status: 'success' }),
      catalogue: [b, a],
    })
    expect(r.lines[0].plant.id).toBe(a.id)
  })

  it('ranks unverified-AI-trait plants (a data-gap band) behind clean ones', () => {
    const clean = plant({ native: false, latin_name: 'Zeta zeta' })
    const unverified = plant({
      native: false,
      ai_origin_fields: ['moisture'],
      latin_name: 'Alpha alpha',
    })
    const r = run({ catalogue: [unverified, clean] })
    expect(r.lines.map((l) => l.plant.id)).toEqual([clean.id, unverified.id])
  })

  it('keeps the original native-first order as the tiebreak within a band', () => {
    const nonNative = plant({ native: false, latin_name: 'Alpha alpha' })
    const native = plant({ native: true, latin_name: 'Zeta zeta' })
    const r = run({ catalogue: [nonNative, native] }) // both clean → both 'high'
    expect(r.lines.map((l) => l.plant.id)).toEqual([native.id, nonNative.id])
  })

  it('snapshots rainfall and location basis for the band (null when climate failed)', () => {
    const withClimate = run({
      catalogue: [plant()],
      enrichment: enrichment({
        rainfall_mm: 750,
        climate_status: 'success',
        location_basis: 'postcode_centroid',
      }),
    })
    expect(withClimate.snapshot.rainfall_mm).toBe(750)
    expect(withClimate.snapshot.location_basis).toBe('postcode_centroid')

    const withoutClimate = run({
      catalogue: [plant()],
      enrichment: enrichment({ rainfall_mm: 750, climate_status: 'unavailable' }),
    })
    expect(withoutClimate.snapshot.rainfall_mm).toBeNull()
  })
})

describe('soil flag', () => {
  it('flags a chosen plant whose soil compatibility misses the site soil', () => {
    const r = run({
      enrichment: enrichment({ soil_type: 'clay' }),
      catalogue: [plant({ soil_compatibility: ['sand'] })],
    })
    expect(r.lines[0].soilFlag).toBe(true)
  })
  it('never flags soil when soil is unavailable', () => {
    const r = run({
      enrichment: enrichment({ soil_type: null, soil_status: 'unavailable' }),
      catalogue: [plant({ soil_compatibility: ['sand'] })],
    })
    expect(r.lines[0].soilFlag).toBe(false)
  })
})

describe('maintenance match', () => {
  it('marks the maintenance reason when the plant matches the preference', () => {
    const r = run({
      maintenancePreference: 'low',
      catalogue: [plant({ maintenance_level: 'low' })],
    })
    expect(r.lines[0].reasons.maintenanceMatch).toBe(true)
  })
})

describe('small-area layer gating', () => {
  it('omits trees below the tree area threshold', () => {
    const r = run({
      scan: scan({ area_sqm: TREE_MIN_AREA_SQM - 1, space_type: 'balcony' }),
      catalogue: [
        plant({ plant_type: 'tree', mature_spread_cm: 200 }),
        plant({ plant_type: 'perennial', mature_spread_cm: 30 }),
      ],
    })
    expect(r.lines.every((l) => l.layer !== 'tree')).toBe(true)
  })
})

describe('quantities', () => {
  it('gives every chosen species at least one plant', () => {
    const r = run({ scan: scan({ area_sqm: 50 }), catalogue: [plant(), plant(), plant()] })
    expect(r.lines.every((l) => l.quantity >= 1)).toBe(true)
  })
  it('reduces density for paved/gravel surfaces', () => {
    const cat = [plant()]
    const soilRun = run({ scan: scan({ surface: 'soil', area_sqm: 40 }), catalogue: cat })
    const pavedRun = run({ scan: scan({ surface: 'paved', area_sqm: 40 }), catalogue: cat })
    expect(pavedRun.lines[0].quantity).toBeLessThan(soilRun.lines[0].quantity)
  })
  it('never exceeds the total quantity cap', () => {
    const r = run({ scan: scan({ area_sqm: 5000 }), catalogue: [plant({ mature_spread_cm: 10 })] })
    const total = r.lines.reduce((s, l) => s + l.quantity, 0)
    expect(total).toBeLessThanOrEqual(200)
  })
})

describe('empty results', () => {
  it('returns an empty plan when nothing survives the hard filters', () => {
    const r = run({ scan: scan({ sun_exposure: 'shade' }), catalogue: [plant({ sun_tolerance: ['full'] })] })
    expect(r.isEmpty).toBe(true)
    expect(r.lines).toHaveLength(0)
  })
})

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const catalogue = [plant(), plant(), plant({ native: false }), plant({ plant_type: 'groundcover' })]
    const a = run({ catalogue })
    const b = run({ catalogue })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('footprintSqm', () => {
  it('converts mature spread (cm) to m²', () => {
    expect(footprintSqm({ mature_spread_cm: 100 })).toBeCloseTo(1)
    expect(footprintSqm({ mature_spread_cm: 50 })).toBeCloseTo(0.25)
  })
})
