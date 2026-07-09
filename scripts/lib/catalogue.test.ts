import { describe, it, expect } from 'vitest'
import {
  SUN_VALUES,
  SOIL_VALUES,
  MOISTURE_VALUES,
  MAINTENANCE_VALUES,
  PLANT_TYPE_VALUES,
  SURVIVAL_CRITICAL_FIELDS as SCRIPT_SCF,
  ZONE_MIN,
  ZONE_MAX,
  SIZE_MIN_CM,
  SIZE_MAX_CM,
  IMPORT_SOURCE,
  SYNCABLE_FIELDS,
  importPlantSchema,
  buildStagedRow,
  needsMandatoryReview,
  orderNativesFirst,
  planCommit,
  planSync,
  toPlantRow,
} from './catalogue.mjs'
import {
  SUN_OPTIONS,
  SOIL_OPTIONS,
  MOISTURE_OPTIONS,
  MAINTENANCE_OPTIONS,
  PLANT_TYPE_OPTIONS,
  SURVIVAL_CRITICAL_FIELDS,
  ZONE_MIN as APP_ZONE_MIN,
  ZONE_MAX as APP_ZONE_MAX,
  SIZE_MIN_CM as APP_SIZE_MIN,
  SIZE_MAX_CM as APP_SIZE_MAX,
  plantSchema,
} from '@/lib/plants'
import { optionValues } from '@/lib/utils'

/**
 * The import pipeline mirrors the app vocabulary in .mjs (Node can't import the TS
 * schema at runtime). These assertions FAIL if either side drifts — the whole point
 * of locking them together so the importer can never stage a value the app rejects.
 */
describe('catalogue vocabulary parity with @/lib/plants', () => {
  it('mirrors every option set', () => {
    expect(SUN_VALUES).toEqual(optionValues(SUN_OPTIONS))
    expect(SOIL_VALUES).toEqual(optionValues(SOIL_OPTIONS))
    expect(MOISTURE_VALUES).toEqual(optionValues(MOISTURE_OPTIONS))
    expect(MAINTENANCE_VALUES).toEqual(optionValues(MAINTENANCE_OPTIONS))
    expect(PLANT_TYPE_VALUES).toEqual(optionValues(PLANT_TYPE_OPTIONS))
  })

  it('mirrors numeric bounds and survival-critical fields', () => {
    expect([ZONE_MIN, ZONE_MAX]).toEqual([APP_ZONE_MIN, APP_ZONE_MAX])
    expect([SIZE_MIN_CM, SIZE_MAX_CM]).toEqual([APP_SIZE_MIN, APP_SIZE_MAX])
    expect(SCRIPT_SCF).toEqual([...SURVIVAL_CRITICAL_FIELDS])
  })
})

const VALID_TRAITS = {
  sun_tolerance: ['full', 'partial'],
  soil_compatibility: ['loam', 'sand'],
  moisture: 'moist',
  min_hardiness_zone: 5,
  mature_height_cm: 80,
  mature_spread_cm: 40,
  maintenance_level: 'low',
  plant_type: 'perennial',
  care_notes: 'Easy border perennial for German gardens.',
  confidence: {
    sun_tolerance: 'high',
    soil_compatibility: 'high',
    moisture: 'high',
    min_hardiness_zone: 'medium',
  },
}

const IDENTITY = { common_name: 'Test-Pflanze', latin_name: 'Testus plantus', native: true }

describe('importPlantSchema', () => {
  it('accepts a valid committable row and the app plantSchema also accepts it', () => {
    const row = toPlantRow(buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' }))
    expect(importPlantSchema.safeParse(row).success).toBe(true)
    // The import row is a superset the app schema (moisture optional) must still accept.
    expect(plantSchema.safeParse(row).success).toBe(true)
  })

  it('requires moisture (the app schema leaves it optional; the import always sets it)', () => {
    const row = toPlantRow(buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' }))
    delete (row as Record<string, unknown>).moisture
    expect(importPlantSchema.safeParse(row).success).toBe(false)
  })

  it('rejects an out-of-vocabulary trait value', () => {
    const row = toPlantRow(buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' }))
    ;(row as Record<string, unknown>).moisture = 'soggy'
    expect(importPlantSchema.safeParse(row).success).toBe(false)
  })

  it('rejects an out-of-range hardiness zone', () => {
    const row = toPlantRow(
      buildStagedRow({ identity: IDENTITY, traits: { ...VALID_TRAITS, min_hardiness_zone: 99 }, status: 'new' }),
    )
    expect(importPlantSchema.safeParse(row).success).toBe(false)
  })
})

describe('buildStagedRow', () => {
  it('records provenance and starts unapproved', () => {
    const row = buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' })
    expect(row.source).toBe(IMPORT_SOURCE)
    expect(row.ai_origin_fields).toEqual([...SURVIVAL_CRITICAL_FIELDS])
    expect(row.approved).toBe(false)
    expect(row.status).toBe('new')
  })

  it('flags mandatory review when a survival-critical field is low confidence', () => {
    const lowConf = { ...VALID_TRAITS, confidence: { ...VALID_TRAITS.confidence, moisture: 'low' } }
    const row = buildStagedRow({ identity: IDENTITY, traits: lowConf, status: 'new' })
    expect(row.review_required).toBe(true)
  })

  it('does not flag review when all survival-critical fields are medium+ confidence', () => {
    const row = buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' })
    expect(row.review_required).toBe(false)
  })
})

describe('needsMandatoryReview', () => {
  it('is true only when at least one survival-critical field is low', () => {
    expect(needsMandatoryReview({ sun_tolerance: 'medium', soil_compatibility: 'high', moisture: 'high', min_hardiness_zone: 'high' })).toBe(false)
    expect(needsMandatoryReview({ sun_tolerance: 'low', soil_compatibility: 'high', moisture: 'high', min_hardiness_zone: 'high' })).toBe(true)
  })
})

describe('orderNativesFirst', () => {
  it('puts natives before non-natives, alphabetical within each group', () => {
    const rows = [
      { latin_name: 'Zeta alpha', native: false },
      { latin_name: 'Beta native', native: true },
      { latin_name: 'Alpha native', native: true },
      { latin_name: 'Alpha alien', native: false },
    ]
    expect(orderNativesFirst(rows).map((r) => r.latin_name)).toEqual([
      'Alpha native',
      'Beta native',
      'Alpha alien',
      'Zeta alpha',
    ])
  })

  it('does not mutate the input array', () => {
    const rows = [{ latin_name: 'B', native: false }, { latin_name: 'A', native: true }]
    const copy = [...rows]
    orderNativesFirst(rows)
    expect(rows).toEqual(copy)
  })
})

describe('planCommit', () => {
  const staged = (overrides: Record<string, unknown>) => ({
    ...buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' }),
    ...overrides,
  })

  it('upserts only approved, review-clear, non-existing, valid rows', () => {
    const rows = [
      staged({ latin_name: 'Approved new', approved: true }),
      staged({ latin_name: 'Unapproved', approved: false }),
      staged({ latin_name: 'Needs review', approved: true, review_required: true }),
      staged({ latin_name: 'Already there', approved: true }),
    ]
    const plan = planCommit(rows, ['Already there'])
    expect(plan.toUpsert.map((r: { latin_name: string }) => r.latin_name)).toEqual(['Approved new'])
    expect(plan.skippedUnapproved).toEqual(['Unapproved'])
    expect(plan.skippedReview).toEqual(['Needs review'])
    expect(plan.skippedExisting).toEqual(['Already there'])
    expect(plan.rejected).toEqual([])
  })

  it('rejects (not commits) an approved row that a hand-edit made invalid', () => {
    const bad = staged({ latin_name: 'Bad edit', approved: true, min_hardiness_zone: 999 })
    const plan = planCommit([bad], [])
    expect(plan.toUpsert).toEqual([])
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0].latin_name).toBe('Bad edit')
  })

  it('never overwrites an existing row even when approved (idempotency)', () => {
    const rows = [staged({ latin_name: 'Salvia nemorosa', approved: true })]
    const plan = planCommit(rows, ['Salvia nemorosa'])
    expect(plan.toUpsert).toEqual([])
    expect(plan.skippedExisting).toEqual(['Salvia nemorosa'])
  })
})

describe('planSync', () => {
  const staged = (overrides: Record<string, unknown>) => ({
    ...buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'existing' }),
    approved: true,
    ...overrides,
  })

  it('updates only syncable fields on an approved, ETL-owned, already-changed row', () => {
    const rows = [staged({ latin_name: 'Corrected', common_name: 'Neuer Name' })]
    const existing = [{ latin_name: 'Corrected', common_name: 'Alter Name', source: IMPORT_SOURCE }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([{ latin_name: 'Corrected', changes: { common_name: 'Neuer Name' } }])
    expect(SYNCABLE_FIELDS).toContain('common_name')
  })

  it('skips unapproved rows', () => {
    const rows = [staged({ latin_name: 'Not approved', approved: false, common_name: 'Neuer Name' })]
    const existing = [{ latin_name: 'Not approved', common_name: 'Alter Name', source: IMPORT_SOURCE }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedUnapproved).toEqual(['Not approved'])
  })

  it('skips rows not yet live', () => {
    const rows = [staged({ latin_name: 'Brand new', common_name: 'Irgendwas' })]
    const plan = planSync(rows, [])
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedNotFound).toEqual(['Brand new'])
  })

  it('never touches a row not created by this ETL — a hand-seeded or admin-authored row', () => {
    const rows = [staged({ latin_name: 'Hand seeded', common_name: 'Neuer Name' })]
    const existing = [{ latin_name: 'Hand seeded', common_name: 'Alter Name', source: null }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedNotEtlOwned).toEqual(['Hand seeded'])
  })

  it('skips a row whose syncable fields already match (idempotency)', () => {
    const rows = [staged({ latin_name: 'Already synced', common_name: 'Gleicher Name' })]
    const existing = [{ latin_name: 'Already synced', common_name: 'Gleicher Name', source: IMPORT_SOURCE }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedNoChange).toEqual(['Already synced'])
  })
})
