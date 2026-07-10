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

/** Ecological traits (PROJ-14). Confidence + provenance keys, and the only allowed
 *  contents of plants.eco_ai_origin_fields. Mirror of ECOLOGICAL_TRAIT_FIELDS in
 *  src/lib/plants.ts (locked by catalogue.test.ts). The bloom pair is ONE entry
 *  (`bloom_period`) — the two months are inferred and verified together. This list is
 *  SEPARATE from SURVIVAL_CRITICAL_FIELDS on purpose: a row can be survival-verified
 *  but ecologically unverified, and the sync backfill pushes eco provenance without
 *  disturbing survival provenance. */
export const ECOLOGICAL_TRAIT_FIELDS = [
  'insect_value',
  'bird_value',
  'bloom_period',
  'pollinator_friendly',
]

/** Every field the AI attaches a confidence to and the review gate protects — both
 *  trait sets feed the ONE `review_required` gate (spec Technical Decision). */
export const CONFIDENCE_FIELDS = [...SURVIVAL_CRITICAL_FIELDS, ...ECOLOGICAL_TRAIT_FIELDS]

/** Ordinal wildlife-value bands — `none` is a real assessed value (wind-pollinated
 *  grass), distinct from a NULL column ("not assessed"). Mirror of WILDLIFE_VALUE_OPTIONS. */
export const WILDLIFE_VALUE_VALUES = ['none', 'low', 'medium', 'high']
export const BLOOM_MONTH_MIN = 1
export const BLOOM_MONTH_MAX = 12

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
  // PROJ-14 ecological traits. The import always assesses insect/bird value and the
  // pollinator flag (the AI returns a band/flag for every plant, `none`/`false`
  // included), so they are REQUIRED here — an AI refusal or out-of-vocabulary value
  // fails validation loudly, never a silent default. The bloom pair is nullable
  // (non-flowering plants have no bloom) and both-or-neither. The app's plantSchema
  // keeps all five nullable+optional for the admin form / pre-existing seed rows.
  insect_value: z.enum(WILDLIFE_VALUE_VALUES),
  bird_value: z.enum(WILDLIFE_VALUE_VALUES),
  bloom_start_month: z.number().int().min(BLOOM_MONTH_MIN).max(BLOOM_MONTH_MAX).nullable(),
  bloom_end_month: z.number().int().min(BLOOM_MONTH_MIN).max(BLOOM_MONTH_MAX).nullable(),
  pollinator_friendly: z.boolean(),
  eco_ai_origin_fields: z.array(z.enum(ECOLOGICAL_TRAIT_FIELDS)),
}).superRefine((v, ctx) => {
  // The bloom period is one fact in two columns: set both or neither. end < start is
  // deliberately VALID — a winter bloomer wrapping the year (Nov→Feb).
  if ((v.bloom_start_month === null) !== (v.bloom_end_month === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [v.bloom_start_month === null ? 'bloom_start_month' : 'bloom_end_month'],
      message: 'Set both bloom months, or leave both null',
    })
  }
})

/** Per-field confidence signal returned by the AI — one rating for every survival
 *  AND ecological trait (the bloom pair shares a single `bloom_period` rating, since
 *  the months are inferred together). Any 'low' here feeds the review gate. */
export const confidenceSchema = z.object({
  sun_tolerance: z.enum(CONFIDENCE_VALUES),
  soil_compatibility: z.enum(CONFIDENCE_VALUES),
  moisture: z.enum(CONFIDENCE_VALUES),
  min_hardiness_zone: z.enum(CONFIDENCE_VALUES),
  insect_value: z.enum(CONFIDENCE_VALUES),
  bird_value: z.enum(CONFIDENCE_VALUES),
  bloom_period: z.enum(CONFIDENCE_VALUES),
  pollinator_friendly: z.enum(CONFIDENCE_VALUES),
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

/** Any trait — survival OR ecological — is under-confident when the AI rated it 'low'.
 *  One gate, fed by both trait sets (PROJ-14 Technical Decision). */
export function lowConfidenceFields(confidence) {
  return CONFIDENCE_FIELDS.filter((f) => confidence?.[f] === 'low')
}

/** True when the row must be reviewed before it can be committed (any survival OR
 *  ecological field at low confidence). Computed at staging time; the curator resolves
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
    // PROJ-14 ecological traits — all AI-drafted at staging time, so every one starts
    // in eco_ai_origin_fields (the curator removes a field as they verify it). Kept
    // SEPARATE from ai_origin_fields so verifying an eco trait never touches survival
    // provenance and vice versa.
    insect_value: traits.insect_value,
    bird_value: traits.bird_value,
    bloom_start_month: traits.bloom_start_month ?? null,
    bloom_end_month: traits.bloom_end_month ?? null,
    pollinator_friendly: traits.pollinator_friendly,
    eco_ai_origin_fields: [...ECOLOGICAL_TRAIT_FIELDS],
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
/** Fields the sync step is allowed to correct on an already-existing, ETL-owned row.
 *  common_name is the original PROJ-11 curator-correction case; the PROJ-14 ecological
 *  columns + eco_ai_origin_fields are added so verified ecological traits backfill onto
 *  the ~160 live rows through this same step (spec: "backfill via extended
 *  SYNCABLE_FIELDS"). Note ai_origin_fields is deliberately NOT here — sync must never
 *  disturb a row's survival provenance. */
export const SYNCABLE_FIELDS = [
  'common_name',
  'insect_value',
  'bird_value',
  'bloom_start_month',
  'bloom_end_month',
  'pollinator_friendly',
  'eco_ai_origin_fields',
]

/** Value equality for a syncable field, order-insensitive for arrays (eco_ai_origin_
 *  fields) so provenance in a different order isn't mistaken for a change. */
function syncFieldEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    const sa = [...a].sort()
    const sb = [...b].sort()
    return sa.every((v, i) => v === sb[i])
  }
  return a === b
}

/**
 * Decide, per staged row, what sync should UPDATE on already-existing rows — without
 * touching the database. Mirrors planCommit's shape but for the opposite case: rows
 * that already exist and need a curator correction / ecological backfill pushed in. A
 * row is only eligible when it is approved, NOT blocked by mandatory review (an
 * unverified low-confidence trait must not reach a live row, same gate as commit),
 * exists live, that live row was created by this ETL (source === IMPORT_SOURCE — never
 * a hand-seeded or admin-authored row, so a manual edit made outside this pipeline can
 * never be clobbered), and at least one syncable field actually differs from the live
 * value.
 */
export function planSync(rows, existingRows) {
  const existingByLatin = new Map(existingRows.map((r) => [r.latin_name, r]))
  const toUpdate = []
  const skippedUnapproved = []
  const skippedReview = []
  const skippedNotFound = []
  const skippedNotEtlOwned = []
  const skippedNoChange = []

  for (const row of rows) {
    if (!row.approved) {
      skippedUnapproved.push(row.latin_name)
      continue
    }
    if (row.review_required) {
      skippedReview.push(row.latin_name)
      continue
    }
    const existing = existingByLatin.get(row.latin_name)
    if (!existing) {
      skippedNotFound.push(row.latin_name)
      continue
    }
    if (existing.source !== IMPORT_SOURCE) {
      skippedNotEtlOwned.push(row.latin_name)
      continue
    }
    const changes = {}
    for (const field of SYNCABLE_FIELDS) {
      if (!syncFieldEqual(row[field], existing[field])) changes[field] = row[field]
    }
    if (Object.keys(changes).length === 0) {
      skippedNoChange.push(row.latin_name)
      continue
    }
    toUpdate.push({ latin_name: row.latin_name, changes })
  }

  return { toUpdate, skippedUnapproved, skippedReview, skippedNotFound, skippedNotEtlOwned, skippedNoChange }
}

/**
 * Ecological-trait coverage over the live catalogue — printed on every live sync run so
 * the PROJ-15 ship decision is made on real numbers, never a hope that "most" plants
 * are covered (spec: "no silent partial coverage"). A trait counts as VERIFIED when it
 * has a value AND is not still marked AI-inferred in eco_ai_origin_fields. `null` and
 * AI-inferred-only both count as not-yet-verified. The bloom pair is one trait
 * (`bloom_period`), assessed when both months are set (both-null = not assessed).
 */
export function ecologicalCoverageReport(rows) {
  const total = rows.length
  const counts = {}
  for (const field of ECOLOGICAL_TRAIT_FIELDS) {
    counts[field] = { assessed: 0, verified: 0, aiInferred: 0, notAssessed: 0 }
  }

  for (const row of rows) {
    const aiFields = new Set(row.eco_ai_origin_fields ?? [])
    for (const field of ECOLOGICAL_TRAIT_FIELDS) {
      const assessed =
        field === 'bloom_period'
          ? row.bloom_start_month != null && row.bloom_end_month != null
          : row[field] != null
      const c = counts[field]
      if (!assessed) {
        c.notAssessed++
        continue
      }
      c.assessed++
      if (aiFields.has(field)) c.aiInferred++
      else c.verified++
    }
  }

  return { total, counts }
}

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
