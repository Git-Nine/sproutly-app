import { describe, it, expect } from 'vitest'
import {
  generatePlan,
  findConstraintViolations,
  type GeneratePlanInput,
  type GeneratedPlan,
} from './plan-engine'
import type { Plant } from './plants'
import type { SunExposure, Surface, SpaceType } from './scans'
// The real seeded catalogue — the exact data PROJ-6 plans from in production.
import { PLANTS } from '../../scripts/seed-plants.mjs'

/**
 * GUARDRAIL (PROJ-6): "every recommended plant can actually survive this site."
 *
 * The engine only ever selects `matchingSurvivors`, so this invariant holds
 * implicitly today. These tests make it EXPLICIT and ENFORCED: if a future
 * change to the selection pipeline — or a bad catalogue row — ever leaks a plant
 * that fails the site's sun / winter-zone / physical-fit constraints into a plan,
 * the build goes red here instead of the user receiving a plant that dies.
 */

const catalogue: Plant[] = (PLANTS as Record<string, unknown>[]).map((p, i) => ({
  id: `seed-${i}`,
  created_at: '2026-06-22',
  updated_at: null,
  image_url: null,
  care_notes: null,
  ...p,
})) as Plant[]

const enrichment = (over: Partial<NonNullable<GeneratePlanInput['enrichment']>> = {}) =>
  ({ soil_type: 'loam', soil_status: 'success', hardiness_zone: '7', zone_status: 'success', ...over }) as GeneratePlanInput['enrichment']

/** Check a generated plan against its own snapshot (sun/zone/area). */
const violationsOf = (plan: GeneratedPlan) =>
  findConstraintViolations({
    plants: plan.lines.map((l) => l.plant),
    sun: plan.snapshot.sun,
    zone: plan.snapshot.zone,
    areaSqm: plan.snapshot.area_sqm,
  })

describe('findConstraintViolations (the guardrail itself)', () => {
  // Build a plan, then tamper with its lines to simulate a pipeline regression
  // that leaked an unsurvivable plant. A trustworthy guardrail must catch each.
  const basePlan = (): GeneratedPlan =>
    generatePlan({
      scan: { sun_exposure: 'full', area_sqm: 30, surface: 'soil', space_type: 'back_garden' },
      enrichment: enrichment(),
      catalogue,
      maintenancePreference: 'low',
    })

  it('passes a correctly generated plan (no violations)', () => {
    expect(violationsOf(basePlan())).toEqual([])
  })

  it('flags a plant whose sun tolerance excludes the site sun', () => {
    const plan = basePlan()
    plan.lines[0].plant = { ...plan.lines[0].plant, sun_tolerance: ['shade'] } // site is full sun
    const v = violationsOf(plan)
    expect(v).toHaveLength(1)
    expect(v[0].reasons).toContain('sun')
  })

  it('flags a plant not hardy enough for the site winter zone', () => {
    const plan = basePlan() // snapshot.zone === 7
    plan.lines[0].plant = { ...plan.lines[0].plant, min_hardiness_zone: 9 }
    const v = violationsOf(plan)
    expect(v).toHaveLength(1)
    expect(v[0].reasons).toContain('zone')
  })

  it('flags a plant too large to physically fit the area', () => {
    const plan = basePlan() // area 30 m²
    plan.lines[0].plant = { ...plan.lines[0].plant, mature_spread_cm: 1000 } // 100 m² footprint
    const v = violationsOf(plan)
    expect(v).toHaveLength(1)
    expect(v[0].reasons).toContain('fit')
  })

  it('does NOT flag on zone when the site zone is unconfirmed', () => {
    const plan = generatePlan({
      scan: { sun_exposure: 'full', area_sqm: 30, surface: 'soil', space_type: 'back_garden' },
      enrichment: enrichment({ hardiness_zone: null, zone_status: 'unavailable' }),
      catalogue,
      maintenancePreference: 'low',
    })
    plan.lines[0].plant = { ...plan.lines[0].plant, min_hardiness_zone: 11 }
    // Zone is null in the snapshot → the zone filter is intentionally not applied.
    expect(violationsOf(plan).every((x) => !x.reasons.includes('zone'))).toBe(true)
  })
})

describe('the real engine never violates its own survival constraints', () => {
  // A matrix of realistic German sites: every sun × area × zone × surface combo.
  const suns: SunExposure[] = ['full', 'partial', 'shade']
  const areas = [1, 3, 4, 15, 30, 120, 5000]
  const zones: { hardiness_zone: string | null; zone_status: 'success' | 'unavailable' }[] = [
    { hardiness_zone: '5', zone_status: 'success' },
    { hardiness_zone: '7', zone_status: 'success' },
    { hardiness_zone: '8', zone_status: 'success' },
    { hardiness_zone: null, zone_status: 'unavailable' },
  ]
  const surfaces: Surface[] = ['soil', 'gravel', 'paved']
  const spaceType: SpaceType = 'back_garden'

  it('produces zero constraint violations across the whole site matrix', () => {
    let plansChecked = 0
    for (const sun of suns) {
      for (const area_sqm of areas) {
        for (const z of zones) {
          for (const surface of surfaces) {
            const plan = generatePlan({
              scan: { sun_exposure: sun, area_sqm, surface, space_type: spaceType },
              enrichment: enrichment(z),
              catalogue,
              maintenancePreference: null,
            })
            plansChecked += 1
            const violations = violationsOf(plan)
            // Surface the offending plant in the failure message, not just a boolean.
            expect(
              violations,
              `site sun=${sun} area=${area_sqm} zone=${z.hardiness_zone} surface=${surface} recommended unsurvivable plant(s): ${JSON.stringify(violations)}`,
            ).toEqual([])
          }
        }
      }
    }
    // Guard the guardrail: make sure the matrix actually ran (no silent skip).
    expect(plansChecked).toBe(suns.length * areas.length * zones.length * surfaces.length)
  })
})
