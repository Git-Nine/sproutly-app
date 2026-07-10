import { describe, it, expect } from 'vitest'
import {
  SUN_VALUES,
  SOIL_VALUES,
  MOISTURE_VALUES,
  MAINTENANCE_VALUES,
  PLANT_TYPE_VALUES,
  WILDLIFE_VALUE_VALUES,
  ECOLOGICAL_TRAIT_FIELDS as SCRIPT_ECO,
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
  ecologicalCoverageReport,
} from './catalogue.mjs'
import {
  SUN_OPTIONS,
  SOIL_OPTIONS,
  MOISTURE_OPTIONS,
  MAINTENANCE_OPTIONS,
  PLANT_TYPE_OPTIONS,
  WILDLIFE_VALUE_OPTIONS,
  ECOLOGICAL_TRAIT_FIELDS,
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
    expect(WILDLIFE_VALUE_VALUES).toEqual(optionValues(WILDLIFE_VALUE_OPTIONS))
  })

  it('mirrors numeric bounds and trait-field lists', () => {
    expect([ZONE_MIN, ZONE_MAX]).toEqual([APP_ZONE_MIN, APP_ZONE_MAX])
    expect([SIZE_MIN_CM, SIZE_MAX_CM]).toEqual([APP_SIZE_MIN, APP_SIZE_MAX])
    expect(SCRIPT_SCF).toEqual([...SURVIVAL_CRITICAL_FIELDS])
    expect(SCRIPT_ECO).toEqual([...ECOLOGICAL_TRAIT_FIELDS])
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
  insect_value: 'high',
  bird_value: 'low',
  bloom_start_month: 5,
  bloom_end_month: 9,
  pollinator_friendly: true,
  confidence: {
    sun_tolerance: 'high',
    soil_compatibility: 'high',
    moisture: 'high',
    min_hardiness_zone: 'medium',
    insect_value: 'high',
    bird_value: 'medium',
    bloom_period: 'high',
    pollinator_friendly: 'high',
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

describe('importPlantSchema — ecological traits (PROJ-14)', () => {
  const ecoRow = (overrides: Record<string, unknown> = {}) => ({
    ...toPlantRow(buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' })),
    ...overrides,
  })

  it('accepts a valid ecological row and the app plantSchema also accepts it', () => {
    const row = ecoRow()
    expect(importPlantSchema.safeParse(row).success).toBe(true)
    expect(plantSchema.safeParse(row).success).toBe(true)
  })

  it("allows 'none' as a real assessed wildlife value (distinct from null / not assessed)", () => {
    expect(importPlantSchema.safeParse(ecoRow({ insect_value: 'none', bird_value: 'none' })).success).toBe(true)
  })

  it('rejects an out-of-vocabulary wildlife band (no silent default)', () => {
    expect(importPlantSchema.safeParse(ecoRow({ insect_value: 'huge' })).success).toBe(false)
  })

  it('requires insect/bird value + pollinator flag (a missing one fails loudly)', () => {
    const row = ecoRow()
    delete (row as Record<string, unknown>).insect_value
    expect(importPlantSchema.safeParse(row).success).toBe(false)
  })

  it('accepts a null bloom pair (non-flowering) but rejects a half-set pair', () => {
    expect(importPlantSchema.safeParse(ecoRow({ bloom_start_month: null, bloom_end_month: null })).success).toBe(true)
    expect(importPlantSchema.safeParse(ecoRow({ bloom_start_month: 5, bloom_end_month: null })).success).toBe(false)
  })

  it('treats end < start as a valid year-wrap (Nov → Feb)', () => {
    expect(importPlantSchema.safeParse(ecoRow({ bloom_start_month: 11, bloom_end_month: 2 })).success).toBe(true)
  })

  it('rejects a bloom month out of the 1–12 range', () => {
    expect(importPlantSchema.safeParse(ecoRow({ bloom_start_month: 0 })).success).toBe(false)
    expect(importPlantSchema.safeParse(ecoRow({ bloom_end_month: 13 })).success).toBe(false)
  })

  it('constrains eco_ai_origin_fields to the ecological vocabulary', () => {
    expect(importPlantSchema.safeParse(ecoRow({ eco_ai_origin_fields: ['moisture'] })).success).toBe(false)
    expect(importPlantSchema.safeParse(ecoRow({ eco_ai_origin_fields: ['bloom_period'] })).success).toBe(true)
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

  it('records ecological provenance in the SEPARATE eco_ai_origin_fields array', () => {
    const row = buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' })
    expect(row.eco_ai_origin_fields).toEqual([...ECOLOGICAL_TRAIT_FIELDS])
    // ecological and survival provenance are independent lists — no overlap.
    expect(row.eco_ai_origin_fields).not.toEqual(row.ai_origin_fields)
  })

  it('copies through the ecological trait values, defaulting an absent bloom pair to null', () => {
    const noBloom = { ...VALID_TRAITS }
    delete (noBloom as Record<string, unknown>).bloom_start_month
    delete (noBloom as Record<string, unknown>).bloom_end_month
    const row = buildStagedRow({ identity: IDENTITY, traits: noBloom, status: 'new' })
    expect(row.insect_value).toBe('high')
    expect(row.pollinator_friendly).toBe(true)
    expect(row.bloom_start_month).toBeNull()
    expect(row.bloom_end_month).toBeNull()
  })

  it('flags mandatory review when a survival-critical field is low confidence', () => {
    const lowConf = { ...VALID_TRAITS, confidence: { ...VALID_TRAITS.confidence, moisture: 'low' } }
    const row = buildStagedRow({ identity: IDENTITY, traits: lowConf, status: 'new' })
    expect(row.review_required).toBe(true)
  })

  it('flags mandatory review when an ECOLOGICAL field is low confidence (one gate, both sets)', () => {
    const lowEco = { ...VALID_TRAITS, confidence: { ...VALID_TRAITS.confidence, insect_value: 'low' } }
    const row = buildStagedRow({ identity: IDENTITY, traits: lowEco, status: 'new' })
    expect(row.review_required).toBe(true)
  })

  it('does not flag review when all survival + ecological fields are medium+ confidence', () => {
    const row = buildStagedRow({ identity: IDENTITY, traits: VALID_TRAITS, status: 'new' })
    expect(row.review_required).toBe(false)
  })
})

describe('needsMandatoryReview', () => {
  const conf = (overrides: Record<string, string> = {}) => ({
    sun_tolerance: 'high',
    soil_compatibility: 'high',
    moisture: 'high',
    min_hardiness_zone: 'high',
    insect_value: 'high',
    bird_value: 'high',
    bloom_period: 'high',
    pollinator_friendly: 'high',
    ...overrides,
  })

  it('is false when every trait is medium+ confidence', () => {
    expect(needsMandatoryReview(conf())).toBe(false)
  })

  it('is true when a survival-critical field is low', () => {
    expect(needsMandatoryReview(conf({ sun_tolerance: 'low' }))).toBe(true)
  })

  it('is true when an ecological field is low', () => {
    expect(needsMandatoryReview(conf({ bloom_period: 'low' }))).toBe(true)
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
  // The live-row values that MATCH a staged VALID_TRAITS row on every eco column, so a
  // test can isolate a single differing field. eco_ai_origin_fields is deliberately in
  // a different order to prove the array comparison is order-insensitive.
  const ecoInSync = {
    insect_value: 'high',
    bird_value: 'low',
    bloom_start_month: 5,
    bloom_end_month: 9,
    pollinator_friendly: true,
    eco_ai_origin_fields: ['bloom_period', 'insect_value', 'pollinator_friendly', 'bird_value'],
  }

  it('updates only the changed syncable field on an approved, ETL-owned row', () => {
    const rows = [staged({ latin_name: 'Corrected', common_name: 'Neuer Name' })]
    const existing = [
      { latin_name: 'Corrected', common_name: 'Alter Name', source: IMPORT_SOURCE, ...ecoInSync },
    ]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([{ latin_name: 'Corrected', changes: { common_name: 'Neuer Name' } }])
    expect(SYNCABLE_FIELDS).toContain('common_name')
  })

  it('backfills the ecological columns onto a live row that has none (nulls → verified values)', () => {
    const rows = [staged({ latin_name: 'Salvia nemorosa', common_name: 'Steppen-Salbei' })]
    const existing = [
      {
        latin_name: 'Salvia nemorosa',
        common_name: 'Steppen-Salbei',
        source: IMPORT_SOURCE,
        insect_value: null,
        bird_value: null,
        bloom_start_month: null,
        bloom_end_month: null,
        pollinator_friendly: null,
        eco_ai_origin_fields: null,
      },
    ]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0].changes).toMatchObject({
      insect_value: 'high',
      bird_value: 'low',
      bloom_start_month: 5,
      bloom_end_month: 9,
      pollinator_friendly: true,
    })
    // common_name is unchanged, so it is NOT in the update set.
    expect(plan.toUpdate[0].changes).not.toHaveProperty('common_name')
  })

  it('never puts ai_origin_fields (survival provenance) in the sync set', () => {
    expect(SYNCABLE_FIELDS).not.toContain('ai_origin_fields')
    expect(SYNCABLE_FIELDS).toContain('eco_ai_origin_fields')
  })

  it('treats eco_ai_origin_fields as equal regardless of order (idempotency)', () => {
    const rows = [staged({ latin_name: 'Already synced', common_name: 'Gleicher Name' })]
    const existing = [
      { latin_name: 'Already synced', common_name: 'Gleicher Name', source: IMPORT_SOURCE, ...ecoInSync },
    ]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedNoChange).toEqual(['Already synced'])
  })

  it('skips unapproved rows', () => {
    const rows = [staged({ latin_name: 'Not approved', approved: false, common_name: 'Neuer Name' })]
    const existing = [{ latin_name: 'Not approved', common_name: 'Alter Name', source: IMPORT_SOURCE }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedUnapproved).toEqual(['Not approved'])
  })

  it('skips a review-required row — an unverified low-confidence trait never reaches a live row', () => {
    const rows = [staged({ latin_name: 'Unverified', common_name: 'Neuer Name', review_required: true })]
    const existing = [{ latin_name: 'Unverified', common_name: 'Alter Name', source: IMPORT_SOURCE }]
    const plan = planSync(rows, existing)
    expect(plan.toUpdate).toEqual([])
    expect(plan.skippedReview).toEqual(['Unverified'])
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
})

describe('ecologicalCoverageReport', () => {
  it('counts a value as verified only when set AND not in eco_ai_origin_fields', () => {
    const rows = [
      // insect verified (set, not AI-inferred), bird still AI-inferred, no bloom, pollinator verified.
      {
        insect_value: 'high',
        bird_value: 'low',
        bloom_start_month: null,
        bloom_end_month: null,
        pollinator_friendly: true,
        eco_ai_origin_fields: ['bird_value'],
      },
      // fully unassessed row.
      {
        insect_value: null,
        bird_value: null,
        bloom_start_month: null,
        bloom_end_month: null,
        pollinator_friendly: null,
        eco_ai_origin_fields: null,
      },
    ]
    const { total, counts } = ecologicalCoverageReport(rows)
    expect(total).toBe(2)
    expect(counts.insect_value).toMatchObject({ verified: 1, aiInferred: 0, notAssessed: 1 })
    expect(counts.bird_value).toMatchObject({ verified: 0, aiInferred: 1, notAssessed: 1 })
    expect(counts.pollinator_friendly).toMatchObject({ verified: 1, notAssessed: 1 })
    expect(counts.bloom_period).toMatchObject({ verified: 0, notAssessed: 2 })
  })

  it('counts bloom as assessed only when BOTH months are set', () => {
    const rows = [
      { bloom_start_month: 11, bloom_end_month: 2, eco_ai_origin_fields: [] }, // wrap, verified
      { bloom_start_month: 5, bloom_end_month: null, eco_ai_origin_fields: [] }, // half-set → not assessed
    ]
    const { counts } = ecologicalCoverageReport(rows)
    expect(counts.bloom_period).toMatchObject({ verified: 1, notAssessed: 1 })
  })
})
