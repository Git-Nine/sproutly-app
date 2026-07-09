// PROJ-11 — AI trait inference.
//
// One Claude call per species fills the horticultural traits no open source carries
// (sun, soil, moisture, mature size, maintenance, plant_type, care notes) and returns
// a per-field confidence signal for the four survival-critical traits. The model is
// BOXED into the app vocabulary via structured output (json_schema), so an
// out-of-vocabulary value can't come back; the result is then re-validated with zod
// (which also enforces the numeric ranges json_schema can't express).
//
// Model: claude-opus-4-8 by default (spec Technical Decision), overridable via
// ANTHROPIC_MODEL. Adaptive thinking + high effort — careful, vocabulary-locked
// inference over survival-critical fields. A safety refusal throws RefusalError so the
// orchestrator can flag that one species and continue, never aborting the whole run.

import { z } from 'zod'
import {
  SUN_VALUES,
  SOIL_VALUES,
  MOISTURE_VALUES,
  MAINTENANCE_VALUES,
  PLANT_TYPE_VALUES,
  CONFIDENCE_VALUES,
  ZONE_MIN,
  ZONE_MAX,
  SIZE_MIN_CM,
  SIZE_MAX_CM,
  NOTES_MAX,
  confidenceSchema,
} from './catalogue.mjs'

export const DEFAULT_MODEL = 'claude-opus-4-8'

export class RefusalError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RefusalError'
  }
}

/** The traits the AI returns (identity + native + image come from the open-data
 *  sources, never the model). Validated after inference — enforces ranges/non-empty
 *  that the json_schema constraint can't express. */
export const aiTraitsSchema = z.object({
  sun_tolerance: z.array(z.enum(SUN_VALUES)).min(1),
  soil_compatibility: z.array(z.enum(SOIL_VALUES)).min(1),
  moisture: z.enum(MOISTURE_VALUES),
  min_hardiness_zone: z.number().int().min(ZONE_MIN).max(ZONE_MAX),
  mature_height_cm: z.number().int().min(SIZE_MIN_CM).max(SIZE_MAX_CM),
  mature_spread_cm: z.number().int().min(SIZE_MIN_CM).max(SIZE_MAX_CM),
  maintenance_level: z.enum(MAINTENANCE_VALUES),
  plant_type: z.enum(PLANT_TYPE_VALUES),
  care_notes: z.string().max(NOTES_MAX),
  confidence: confidenceSchema,
})

/** JSON schema for structured output. Enums lock the vocabulary at the source; ranges
 *  are validated afterwards by aiTraitsSchema (json_schema can't express min/max). */
export const traitsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sun_tolerance',
    'soil_compatibility',
    'moisture',
    'min_hardiness_zone',
    'mature_height_cm',
    'mature_spread_cm',
    'maintenance_level',
    'plant_type',
    'care_notes',
    'confidence',
  ],
  properties: {
    sun_tolerance: { type: 'array', items: { type: 'string', enum: SUN_VALUES } },
    soil_compatibility: { type: 'array', items: { type: 'string', enum: SOIL_VALUES } },
    moisture: { type: 'string', enum: MOISTURE_VALUES },
    min_hardiness_zone: { type: 'integer' },
    mature_height_cm: { type: 'integer' },
    mature_spread_cm: { type: 'integer' },
    maintenance_level: { type: 'string', enum: MAINTENANCE_VALUES },
    plant_type: { type: 'string', enum: PLANT_TYPE_VALUES },
    care_notes: { type: 'string' },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['sun_tolerance', 'soil_compatibility', 'moisture', 'min_hardiness_zone'],
      properties: {
        sun_tolerance: { type: 'string', enum: CONFIDENCE_VALUES },
        soil_compatibility: { type: 'string', enum: CONFIDENCE_VALUES },
        moisture: { type: 'string', enum: CONFIDENCE_VALUES },
        min_hardiness_zone: { type: 'string', enum: CONFIDENCE_VALUES },
      },
    },
  },
}

const SYSTEM_PROMPT = `You are a horticultural data specialist for a Germany-first planting-plan app.
Given a plant species, infer the gardening traits the app needs, choosing ONLY from the app's fixed vocabulary.

Rules:
- sun_tolerance: the sun conditions the plant tolerates (one or more of full, partial, shade).
- soil_compatibility: garden soil types it grows in (one or more of sand, loam, clay, silt, peat).
- moisture: its water need as one bucket — dry, moist, or wet (Ellenberg F: dry ≈ F1–4, moist ≈ F5–7, wet ≈ F8+).
- min_hardiness_zone: the coldest USDA zone (whole number) it reliably survives; Germany spans roughly 5–8.
- mature_height_cm / mature_spread_cm: open-grown mature size in centimetres.
- maintenance_level: low, medium, or high for a home gardener.
- plant_type: its structural layer — groundcover, perennial, shrub, or tree.
- care_notes: one or two plain sentences of practical care guidance.
- confidence: for EACH survival-critical field (sun_tolerance, soil_compatibility, moisture, min_hardiness_zone),
  rate your confidence high, medium, or low. Be honest — low confidence flags the row for mandatory human review.

Base your answer on established horticultural knowledge for temperate Central European (German) gardens.
When Ellenberg indicator values are provided, use them to ground the sun (L) and moisture (F) traits.`

function buildUserPrompt({ latinName, commonName, native, ellenberg }) {
  const lines = [
    `Species (Latin): ${latinName}`,
    commonName ? `Common name (German): ${commonName}` : null,
    `Native to Germany: ${native ? 'yes' : 'no'}`,
    ellenberg?.light != null ? `Ellenberg light value (L): ${ellenberg.light}` : null,
    ellenberg?.moisture != null ? `Ellenberg moisture value (F): ${ellenberg.moisture}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

function extractJsonText(response) {
  const block = (response?.content ?? []).find((b) => b.type === 'text' && typeof b.text === 'string')
  return block?.text ?? null
}

/**
 * Infer traits for one species. `client` is an Anthropic SDK instance (injected so
 * tests can supply a fake). Returns a validated traits object (aiTraitsSchema).
 * Throws RefusalError on a safety refusal and Error on a truncated (max_tokens) or
 * unparseable / invalid response so the caller can flag that one species and move on.
 *
 * @param {{ latinName: string, commonName?: string, native: boolean, ellenberg?: { light?: number, moisture?: number } }} candidate
 * @param {{ client?: unknown, model?: string, maxTokens?: number }} [opts]
 */
export async function inferTraits(candidate, { client, model = DEFAULT_MODEL, maxTokens = 8192 } = {}) {
  if (!client) throw new Error('inferTraits requires an Anthropic `client`')

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: traitsJsonSchema } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(candidate) }],
  })

  if (response?.stop_reason === 'refusal') {
    throw new RefusalError(`Model refused to infer traits for "${candidate.latinName}"`)
  }

  // Adaptive thinking counts against max_tokens on Opus 4.8, so a low budget can be
  // consumed before the JSON is emitted — surface that clearly instead of letting it
  // fall through to a confusing "no text"/parse failure.
  if (response?.stop_reason === 'max_tokens') {
    throw new Error(
      `Response truncated (stop_reason=max_tokens) for "${candidate.latinName}" — raise maxTokens (currently ${maxTokens}) or lower effort`,
    )
  }

  const jsonText = extractJsonText(response)
  if (!jsonText) {
    throw new Error(`No text content returned for "${candidate.latinName}"`)
  }

  let raw
  try {
    raw = JSON.parse(jsonText)
  } catch (cause) {
    throw new Error(`Could not parse trait JSON for "${candidate.latinName}"`, { cause })
  }

  const parsed = aiTraitsSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`AI traits out of vocabulary/range for "${candidate.latinName}": ${detail}`)
  }
  return parsed.data
}
