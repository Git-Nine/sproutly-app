import { describe, it, expect } from 'vitest'
import { computeQuantities, matchingSurvivors } from './plan-engine'
import { mergeDuplicateLines, isPlanStale, type Plan, type PlanPlantWithPlant } from './plans'
import type { Plant } from './plants'
import type { Scan, ScanEnrichment } from './scans'

/**
 * PROJ-7 — the pure helpers behind interactive editing: rebalance-with-pins,
 * the "add" survivor list, duplicate-line merge, and staleness detection.
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

describe('computeQuantities — rebalance with pins', () => {
  it('gives every plant at least one', () => {
    const plants = [plant(), plant(), plant()]
    const q = computeQuantities({ plants, areaSqm: 30, surface: 'soil', pinned: {} })
    expect(plants.every((p) => q[p.id] >= 1)).toBe(true)
  })

  it('keeps a pinned quantity exactly and only moves the un-pinned', () => {
    const a = plant({ plant_type: 'perennial' })
    const b = plant({ plant_type: 'perennial' })
    const before = computeQuantities({ plants: [a, b], areaSqm: 40, surface: 'soil', pinned: {} })
    const after = computeQuantities({
      plants: [a, b],
      areaSqm: 40,
      surface: 'soil',
      pinned: { [a.id]: 99 },
    })
    expect(after[a.id]).toBe(99) // pinned value kept exactly
    expect(after[b.id]).not.toBe(before[b.id]) // b (un-pinned) is recomputed for the remaining area
    expect(after[b.id]).toBeGreaterThanOrEqual(1)
  })

  it('reduces density for paved/gravel', () => {
    const p = plant()
    const soil = computeQuantities({ plants: [p], areaSqm: 40, surface: 'soil', pinned: {} })
    const paved = computeQuantities({ plants: [p], areaSqm: 40, surface: 'paved', pinned: {} })
    expect(paved[p.id]).toBeLessThan(soil[p.id])
  })

  it('never exceeds the 200 cap', () => {
    const p = plant({ mature_spread_cm: 10 })
    const q = computeQuantities({ plants: [p], areaSqm: 5000, surface: 'soil', pinned: {} })
    expect(q[p.id]).toBeLessThanOrEqual(200)
  })

  it('handles an empty set without crashing', () => {
    expect(computeQuantities({ plants: [], areaSqm: 30, surface: 'soil', pinned: {} })).toEqual({})
  })

  it('keeps every quantity when all plants are pinned (no rebalancing)', () => {
    const a = plant()
    const b = plant()
    const q = computeQuantities({
      plants: [a, b],
      areaSqm: 40,
      surface: 'soil',
      pinned: { [a.id]: 3, [b.id]: 7 },
    })
    expect(q[a.id]).toBe(3)
    expect(q[b.id]).toBe(7)
  })
})

describe('matchingSurvivors', () => {
  const scan = { sun_exposure: 'full', area_sqm: 30, surface: 'soil', space_type: 'back_garden' } as Pick<
    Scan,
    'sun_exposure' | 'area_sqm' | 'surface' | 'space_type'
  >
  const enrichment = {
    soil_type: 'loam',
    soil_status: 'success',
    hardiness_zone: '7',
    zone_status: 'success',
  } as Pick<ScanEnrichment, 'soil_type' | 'soil_status' | 'hardiness_zone' | 'zone_status'>

  it('keeps only plants passing sun, zone and fit', () => {
    const ok = plant({ sun_tolerance: ['full'], min_hardiness_zone: 5, mature_spread_cm: 40 })
    const wrongSun = plant({ sun_tolerance: ['shade'] })
    const tooTender = plant({ min_hardiness_zone: 9 })
    const tooBig = plant({ mature_spread_cm: 600 }) // 36 m² > 30 m²
    const survivors = matchingSurvivors({ scan, enrichment, catalogue: [ok, wrongSun, tooTender, tooBig] })
    expect(survivors.map((p) => p.id)).toEqual([ok.id])
  })
})

describe('mergeDuplicateLines', () => {
  function line(plantId: string, qty: number, over: Partial<PlanPlantWithPlant> = {}): PlanPlantWithPlant {
    return {
      id: `l-${plantId}-${qty}`,
      plan_id: 'plan1',
      plant_id: plantId,
      quantity: qty,
      sort_order: 0,
      soil_flag: false,
      pinned: false,
      rationale: null,
      created_at: '2026-01-01',
      plants: plant({ id: plantId }),
      ...over,
    }
  }

  it('sums quantities for the same plant and keeps pinned/flag if any', () => {
    const merged = mergeDuplicateLines([
      line('px', 3, { sort_order: 1 }),
      line('px', 2, { sort_order: 5, pinned: true, soil_flag: true }),
      line('py', 4, { sort_order: 2 }),
    ])
    expect(merged).toHaveLength(2)
    const px = merged.find((l) => l.plant_id === 'px')!
    expect(px.quantity).toBe(5)
    expect(px.pinned).toBe(true)
    expect(px.soil_flag).toBe(true)
    expect(px.sort_order).toBe(1) // earliest kept
  })

  it('passes lines through unchanged when there are no duplicates (ordered by sort_order)', () => {
    const merged = mergeDuplicateLines([line('pb', 1, { sort_order: 2 }), line('pa', 1, { sort_order: 1 })])
    expect(merged.map((l) => l.plant_id)).toEqual(['pa', 'pb'])
  })
})

describe('isPlanStale', () => {
  const basePlan: Plan = {
    id: 'plan1',
    scan_id: 'scan1',
    user_id: 'u1',
    snapshot_sun: 'full',
    snapshot_area_sqm: 30,
    snapshot_surface: 'soil',
    snapshot_space_type: 'back_garden',
    snapshot_soil: 'loam',
    snapshot_zone: 7,
    snapshot_maintenance: 'low',
    zone_unconfirmed: false,
    extra_match_count: 0,
    rationale_intro: null,
    created_at: '2026-01-01',
    updated_at: null,
  }
  const scan = {
    sun_exposure: 'full',
    area_sqm: 30,
    surface: 'soil',
    space_type: 'back_garden',
  } as Pick<Scan, 'sun_exposure' | 'area_sqm' | 'surface' | 'space_type'>
  const enrichment = {
    soil_type: 'loam',
    soil_status: 'success',
    hardiness_zone: '7',
    zone_status: 'success',
  } as ScanEnrichment

  it('is not stale when matching inputs are unchanged', () => {
    expect(isPlanStale(basePlan, { scan, enrichment, maintenancePreference: 'low' })).toBe(false)
  })

  it('is stale when a matching input changed (area)', () => {
    expect(
      isPlanStale(basePlan, { scan: { ...scan, area_sqm: 60 }, enrichment, maintenancePreference: 'low' }),
    ).toBe(true)
  })

  it('is stale when soil enrichment changed', () => {
    const e = { ...enrichment, soil_type: 'clay' } as ScanEnrichment
    expect(isPlanStale(basePlan, { scan, enrichment: e, maintenancePreference: 'low' })).toBe(true)
  })

  it('is stale when the maintenance preference changed', () => {
    expect(isPlanStale(basePlan, { scan, enrichment, maintenancePreference: 'high' })).toBe(true)
  })
})
