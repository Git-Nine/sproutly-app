import { describe, it, expect } from 'vitest'
import {
  plantSchema,
  soilLabel,
  maintenanceLabel,
  sunToleranceSummary,
  wildlifeValueLabel,
  monthLabel,
  bloomPeriodSummary,
  SOIL_OPTIONS,
  WILDLIFE_VALUE_OPTIONS,
  MONTH_OPTIONS,
  ZONE_OPTIONS,
  ZONE_MIN,
  ZONE_MAX,
} from './plants'

/**
 * PROJ-5 — the shared plant contract. plantSchema is the single validation gate
 * the admin form runs (and mirrors the DB CHECK constraints), so these cover the
 * "validation error names each offending field / nothing saved" acceptance
 * criteria at the logic layer.
 */

const valid = {
  common_name: 'Echter Lavendel',
  latin_name: 'Lavandula angustifolia',
  sun_tolerance: ['full'],
  soil_compatibility: ['sand', 'loam'],
  min_hardiness_zone: 6,
  mature_height_cm: 60,
  mature_spread_cm: 60,
  maintenance_level: 'low',
  plant_type: 'shrub',
  native: false,
  image_url: '',
  care_notes: '',
}

describe('plantSchema — happy path', () => {
  it('accepts a fully valid plant', () => {
    expect(plantSchema.safeParse(valid).success).toBe(true)
  })

  it('treats image_url and care_notes as optional (empty + undefined both pass)', () => {
    expect(plantSchema.safeParse({ ...valid, image_url: '', care_notes: '' }).success).toBe(true)
    const { image_url: _i, care_notes: _c, ...withoutOptionals } = valid
    expect(plantSchema.safeParse(withoutOptionals).success).toBe(true)
  })

  it('accepts a well-formed http(s) image URL', () => {
    expect(plantSchema.safeParse({ ...valid, image_url: 'https://example.com/plant.jpg' }).success).toBe(true)
  })

  it('accepts multi-value sun and soil sets', () => {
    const r = plantSchema.safeParse({
      ...valid,
      sun_tolerance: ['full', 'partial', 'shade'],
      soil_compatibility: ['sand', 'loam', 'clay', 'silt', 'peat'],
    })
    expect(r.success).toBe(true)
  })
})

describe('plantSchema — required field validation', () => {
  it('rejects an empty common name', () => {
    const r = plantSchema.safeParse({ ...valid, common_name: '' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.common_name?.[0]).toBeTruthy()
  })

  it('rejects an empty Latin name', () => {
    const r = plantSchema.safeParse({ ...valid, latin_name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects an empty sun_tolerance set', () => {
    const r = plantSchema.safeParse({ ...valid, sun_tolerance: [] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.sun_tolerance?.[0]).toMatch(/at least one/i)
  })

  it('rejects an unknown sun value', () => {
    expect(plantSchema.safeParse({ ...valid, sun_tolerance: ['blazing'] }).success).toBe(false)
  })

  it('rejects an empty soil_compatibility set', () => {
    expect(plantSchema.safeParse({ ...valid, soil_compatibility: [] }).success).toBe(false)
  })

  it('rejects an unknown soil value', () => {
    expect(plantSchema.safeParse({ ...valid, soil_compatibility: ['gravel'] }).success).toBe(false)
  })

  it('rejects an invalid maintenance level', () => {
    expect(plantSchema.safeParse({ ...valid, maintenance_level: 'extreme' }).success).toBe(false)
  })

  it('rejects a missing or invalid plant type', () => {
    const { plant_type: _omit, ...withoutType } = valid
    expect(plantSchema.safeParse(withoutType).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, plant_type: 'cactus' }).success).toBe(false)
  })

  it('accepts every valid plant type', () => {
    for (const t of ['groundcover', 'perennial', 'shrub', 'tree']) {
      expect(plantSchema.safeParse({ ...valid, plant_type: t }).success).toBe(true)
    }
  })
})

describe('plantSchema — numeric bounds', () => {
  it(`rejects a hardiness zone below ${ZONE_MIN} or above ${ZONE_MAX}`, () => {
    expect(plantSchema.safeParse({ ...valid, min_hardiness_zone: ZONE_MIN - 1 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, min_hardiness_zone: ZONE_MAX + 1 }).success).toBe(false)
  })

  it('rejects a non-integer hardiness zone', () => {
    expect(plantSchema.safeParse({ ...valid, min_hardiness_zone: 6.5 }).success).toBe(false)
  })

  it('rejects NaN dimensions (empty numeric input)', () => {
    expect(plantSchema.safeParse({ ...valid, mature_height_cm: NaN }).success).toBe(false)
  })

  it('rejects out-of-range height and spread', () => {
    expect(plantSchema.safeParse({ ...valid, mature_height_cm: 0 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, mature_height_cm: 3001 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, mature_spread_cm: 0 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, mature_spread_cm: 3001 }).success).toBe(false)
  })
})

describe('plantSchema — image URL validation', () => {
  it('rejects a malformed URL', () => {
    const r = plantSchema.safeParse({ ...valid, image_url: 'not a url' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.image_url?.[0]).toMatch(/valid/i)
  })

  // BUG-2 fix (PROJ-6): http(s) only — javascript:/data: schemes are now rejected
  // at the schema (and a DB CHECK in /backend), since PROJ-6 is the first feature
  // to actually render the plant image.
  it('rejects non-http(s) schemes (javascript: / data:)', () => {
    expect(plantSchema.safeParse({ ...valid, image_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, image_url: 'data:text/html,<script>' }).success).toBe(false)
  })
})

describe('plantSchema — care notes length', () => {
  it('rejects care notes over the maximum length', () => {
    expect(plantSchema.safeParse({ ...valid, care_notes: 'x'.repeat(2001) }).success).toBe(false)
  })
})

/**
 * PROJ-14 — ecological traits. All nullable/optional (backward compatible:
 * the `valid` fixture above has none of them and must keep passing, which the
 * happy-path suite already asserts). NULL = not assessed; 'none'/false =
 * assessed with genuinely no value — two distinct representable states.
 */
describe('plantSchema — ecological traits (PROJ-14)', () => {
  it('accepts a fully assessed ecological trait set', () => {
    const r = plantSchema.safeParse({
      ...valid,
      insect_value: 'high',
      bird_value: 'medium',
      bloom_start_month: 5,
      bloom_end_month: 9,
      pollinator_friendly: true,
    })
    expect(r.success).toBe(true)
  })

  it('accepts explicit nulls (not assessed) for every ecological trait', () => {
    const r = plantSchema.safeParse({
      ...valid,
      insect_value: null,
      bird_value: null,
      bloom_start_month: null,
      bloom_end_month: null,
      pollinator_friendly: null,
    })
    expect(r.success).toBe(true)
  })

  it("accepts 'none' and false as real assessed values (distinct from null)", () => {
    const r = plantSchema.safeParse({
      ...valid,
      insect_value: 'none',
      bird_value: 'none',
      pollinator_friendly: false,
    })
    expect(r.success).toBe(true)
  })

  it('rejects an out-of-vocabulary wildlife value', () => {
    expect(plantSchema.safeParse({ ...valid, insect_value: 'huge' }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, bird_value: 'unknown' }).success).toBe(false)
  })

  it('rejects out-of-range or fractional bloom months', () => {
    expect(plantSchema.safeParse({ ...valid, bloom_start_month: 0, bloom_end_month: 5 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, bloom_start_month: 5, bloom_end_month: 13 }).success).toBe(false)
    expect(plantSchema.safeParse({ ...valid, bloom_start_month: 5.5, bloom_end_month: 9 }).success).toBe(false)
  })

  it('accepts a year-wrapping bloom period (end before start, e.g. Nov → Feb)', () => {
    const r = plantSchema.safeParse({ ...valid, bloom_start_month: 11, bloom_end_month: 2 })
    expect(r.success).toBe(true)
  })

  it('rejects a half-set bloom pair (one month without the other)', () => {
    const startOnly = plantSchema.safeParse({ ...valid, bloom_start_month: 5, bloom_end_month: null })
    expect(startOnly.success).toBe(false)
    if (!startOnly.success) {
      expect(startOnly.error.flatten().fieldErrors.bloom_end_month?.[0]).toMatch(/both/i)
    }
    const endOnly = plantSchema.safeParse({ ...valid, bloom_start_month: null, bloom_end_month: 9 })
    expect(endOnly.success).toBe(false)
    if (!endOnly.success) {
      expect(endOnly.error.flatten().fieldErrors.bloom_start_month?.[0]).toMatch(/both/i)
    }
  })

  it('accepts eco provenance entries and rejects unknown ones', () => {
    expect(
      plantSchema.safeParse({ ...valid, eco_ai_origin_fields: ['insect_value', 'bloom_period'] }).success,
    ).toBe(true)
    expect(plantSchema.safeParse({ ...valid, eco_ai_origin_fields: ['native'] }).success).toBe(false)
  })
})

describe('ecological label helpers (PROJ-14)', () => {
  it('maps every wildlife value to a label', () => {
    for (const o of WILDLIFE_VALUE_OPTIONS) expect(wildlifeValueLabel(o.value)).toBe(o.label)
  })

  it('maps all 12 months to names', () => {
    expect(MONTH_OPTIONS).toHaveLength(12)
    expect(monthLabel(1)).toBe('January')
    expect(monthLabel(12)).toBe('December')
  })

  it('summarizes a bloom period, annotating the year-wrap case', () => {
    expect(bloomPeriodSummary(5, 9)).toBe('May – September')
    expect(bloomPeriodSummary(11, 2)).toBe('November – February (over winter)')
    expect(bloomPeriodSummary(null, 9)).toBeNull()
    expect(bloomPeriodSummary(5, null)).toBeNull()
  })
})

describe('label + summary helpers', () => {
  it('maps every soil value to a label', () => {
    for (const o of SOIL_OPTIONS) expect(soilLabel(o.value)).toBe(o.label)
  })

  it('maps maintenance values to labels', () => {
    expect(maintenanceLabel('low')).toBe('Low')
    expect(maintenanceLabel('high')).toBe('High')
  })

  it('joins a sun tolerance set into a readable summary', () => {
    expect(sunToleranceSummary(['full', 'partial'])).toBe('Full sun · Partial sun')
  })

  it('exposes the full whole-number zone range as options', () => {
    expect(ZONE_OPTIONS[0]).toBe(ZONE_MIN)
    expect(ZONE_OPTIONS[ZONE_OPTIONS.length - 1]).toBe(ZONE_MAX)
  })
})
