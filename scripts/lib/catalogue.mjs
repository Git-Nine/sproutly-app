// PROJ-11 — catalogue contract for the offline import pipeline.
//
// This is the vocabulary + validation the two import scripts share. Node can't
// import the app's TypeScript `plantSchema` at runtime, so the allowed values are
// mirrored here (exactly as scripts/seed-plants.mjs mirrors them). catalogue.test.ts
// imports BOTH this module and `@/lib/plants` and asserts they stay locked together —
// a drift in either fails the test, never ships silently.
//
// The AI is boxed into these buckets at inference time (structured output) and every
// value is re-validated here before staging AND again before commit, so an
// out-of-vocabulary or nonsensical trait is rejected at the source, never written.

import { z } from 'zod'

// ---- Vocabulary (mirror of src/lib/*, guarded by catalogue.test.ts) ----
export const SUN_VALUES = ['full', 'partial', 'shade']
export const SOIL_VALUES = ['sand', 'loam', 'clay', 'silt', 'peat']
export const MOISTURE_VALUES = ['dry', 'moist', 'wet']
export const MAINTENANCE_VALUES = ['low', 'medium', 'high']
export const PLANT_TYPE_VALUES = ['groundcover', 'perennial', 'shrub', 'tree']

export const ZONE_MIN = 1
export const ZONE_MAX = 12
export const SIZE_MIN_CM = 1
export const SIZE_MAX_CM = 3000
export const COMMON_NAME_MAX = 100
export const LATIN_NAME_MAX = 120
export const NOTES_MAX = 2000
export const ATTRIBUTION_MAX = 500
export const LICENSE_MAX = 100
export const SOURCE_MAX = 100

/** Survival-critical traits — the ones the AI confidence gate protects and the only
 *  allowed contents of plants.ai_origin_fields. Mirror of SURVIVAL_CRITICAL_FIELDS. */
export const SURVIVAL_CRITICAL_FIELDS = [
  'sun_tolerance',
  'soil_compatibility',
  'moisture',
  'min_hardiness_zone',
]

export const CONFIDENCE_VALUES = ['high', 'medium', 'low']

/** Row-level provenance marker written to plants.source for every imported row. */
export const IMPORT_SOURCE = 'open_data_etl'

const nonEmptySubset = (allowed, label) =>
  z
    .array(z.enum(allowed))
    .min(1, `Pick at least one ${label}`)
    .refine((arr) => new Set(arr).size === arr.length, `Duplicate ${label} value`)

/**
 * The full, committable plant row. Mirrors the app's `plantSchema` but makes
 * `moisture` REQUIRED (the import always populates it) and adds the provenance
 * columns. Used to validate every staged row before it is written AND every row
 * again server-side before commit — a bad hand-edit is rejected here, not at the DB.
 */
export const importPlantSchema = z.object({
  common_name: z.string().trim().min(1).max(COMMON_NAME_MAX),
  latin_name: z.string().trim().min(1).max(LATIN_NAME_MAX),
  sun_tolerance: nonEmptySubset(SUN_VALUES, 'sun condition'),
  soil_compatibility: nonEmptySubset(SOIL_VALUES, 'soil type'),
  moisture: z.enum(MOISTURE_VALUES),
  min_hardiness_zone: z.number().int().min(ZONE_MIN).max(ZONE_MAX),
  mature_height_cm: z.number().int().min(SIZE_MIN_CM).max(SIZE_MAX_CM),
  mature_spread_cm: z.number().int().min(SIZE_MIN_CM).max(SIZE_MAX_CM),
  maintenance_level: z.enum(MAINTENANCE_VALUES),
  plant_type: z.enum(PLANT_TYPE_VALUES),
  native: z.boolean(),
  image_url: z
    .string()
    .trim()
    .refine((v) => /^https?:\/\//.test(v), 'Enter a valid http(s) URL')
    .nullable()
    .optional(),
  image_attribution: z.string().trim().max(ATTRIBUTION_MAX).nullable().optional(),
  image_license: z.string().trim().max(LICENSE_MAX).nullable().optional(),
  care_notes: z.string().trim().max(NOTES_MAX).nullable().optional(),
  source: z.string().trim().max(SOURCE_MAX),
  ai_origin_fields: z.array(z.enum(SURVIVAL_CRITICAL_FIELDS)),
})

/** Per-survival-critical-field confidence signal returned by the AI. */
export const confidenceSchema = z.object({
  sun_tolerance: z.enum(CONFIDENCE_VALUES),
  soil_compatibility: z.enum(CONFIDENCE_VALUES),
  moisture: z.enum(CONFIDENCE_VALUES),
  min_hardiness_zone: z.enum(CONFIDENCE_VALUES),
})

/**
 * One entry in the human-readable staging file. Carries the committable plant
 * fields plus the review metadata a curator works with: per-field confidence, the
 * mandatory-review flag, the approved flag they flip, and existing/conflict status.
 */
export const stagedRowSchema = importPlantSchema.extend({
  confidence: confidenceSchema,
  review_required: z.boolean(),
  approved: z.boolean(),
  status: z.enum(['new', 'existing']),
})

/** A survival-critical field is under-confident when the AI rated it 'low'. */
export function lowConfidenceFields(confidence) {
  return SURVIVAL_CRITICAL_FIELDS.filter((f) => confidence?.[f] === 'low')
}

/** True when the row must be reviewed before it can be committed (any survival-
 *  critical field at low confidence). Computed at staging time; the curator resolves
 *  it by correcting the value and setting review_required:false. */
export function needsMandatoryReview(confidence) {
  return lowConfidenceFields(confidence).length > 0
}

/** Natives first, then alphabetical by latin name — stable, deterministic ordering
 *  for the staging file (spec: "natives surfaced first"). Does not mutate the input. */
export function orderNativesFirst(rows) {
  return [...rows].sort((a, b) => {
    if (a.native !== b.native) return a.native ? -1 : 1
    return a.latin_name.localeCompare(b.latin_name)
  })
}

/**
 * Assemble a staging entry from resolved identity + AI-inferred traits. Sets the
 * review gate (review_required = any survival-critical field at low confidence),
 * marks the row unapproved (the curator flips it), records provenance
 * (source = open_data_etl, ai_origin_fields = all four survival-critical traits since
 * they all start as AI guesses), and tags existing-in-catalogue rows as conflicts.
 */
export function buildStagedRow({ identity, traits, status }) {
  return {
    common_name: identity.common_name,
    latin_name: identity.latin_name,
    native: identity.native,
    image_url: identity.image_url ?? null,
    image_attribution: identity.image_attribution ?? null,
    image_license: identity.image_license ?? null,
    sun_tolerance: traits.sun_tolerance,
    soil_compatibility: traits.soil_compatibility,
    moisture: traits.moisture,
    min_hardiness_zone: traits.min_hardiness_zone,
    mature_height_cm: traits.mature_height_cm,
    mature_spread_cm: traits.mature_spread_cm,
    maintenance_level: traits.maintenance_level,
    plant_type: traits.plant_type,
    care_notes: traits.care_notes,
    source: IMPORT_SOURCE,
    ai_origin_fields: [...SURVIVAL_CRITICAL_FIELDS],
    confidence: traits.confidence,
    review_required: needsMandatoryReview(traits.confidence),
    approved: false,
    status,
  }
}

/** Strip the staging-only metadata, leaving exactly the columns public.plants stores. */
export function toPlantRow(staged) {
  const {
    confidence: _confidence,
    review_required: _review,
    approved: _approved,
    status: _status,
    ...plant
  } = staged
  return plant
}

/**
 * Decide, per staged row, what commit should do — without touching the database.
 * Idempotency + the review gate live here so they're unit-testable.
 *
 * A row is upserted only when it is: approved, not blocked by mandatory review,
 * not already in the catalogue, and passes importPlantSchema. Everything else lands
 * in a reported bucket (never silently dropped). Existing rows are reported as
 * skipped even if approved — commit never clobbers an admin's edit (ON CONFLICT DO
 * NOTHING is the DB-side belt-and-suspenders).
 */
export function planCommit(rows, existingLatinNames) {
  const existing = new Set(existingLatinNames)
  const toUpsert = []
  const skippedUnapproved = []
  const skippedReview = []
  const skippedExisting = []
  const rejected = []

  for (const row of rows) {
    if (!row.approved) {
      skippedUnapproved.push(row.latin_name)
      continue
    }
    if (row.review_required) {
      skippedReview.push(row.latin_name)
      continue
    }
    if (existing.has(row.latin_name)) {
      skippedExisting.push(row.latin_name)
      continue
    }
    const plant = toPlantRow(row)
    const parsed = importPlantSchema.safeParse(plant)
    if (!parsed.success) {
      rejected.push({
        latin_name: row.latin_name,
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(row)'}: ${i.message}`),
      })
      continue
    }
    toUpsert.push(parsed.data)
  }

  return { toUpsert, skippedUnapproved, skippedReview, skippedExisting, rejected }
}
