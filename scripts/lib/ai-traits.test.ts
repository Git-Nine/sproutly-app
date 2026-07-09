import { describe, it, expect } from 'vitest'
import {
  inferTraits,
  RefusalError,
  aiTraitsSchema,
  traitsJsonSchema,
} from './ai-traits.mjs'

const VALID = {
  sun_tolerance: ['full', 'partial'],
  soil_compatibility: ['loam'],
  moisture: 'moist',
  min_hardiness_zone: 5,
  mature_height_cm: 60,
  mature_spread_cm: 40,
  maintenance_level: 'low',
  plant_type: 'perennial',
  care_notes: 'A reliable border perennial.',
  confidence: { sun_tolerance: 'high', soil_compatibility: 'high', moisture: 'medium', min_hardiness_zone: 'low' },
}

/** Fake Anthropic client returning a canned message. */
function fakeClient(response: unknown) {
  return { messages: { create: async () => response } }
}
function jsonResponse(obj: unknown, stop_reason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

const candidate = { latinName: 'Testus plantus', commonName: 'Test-Pflanze', native: true }

describe('inferTraits', () => {
  it('returns the validated traits on a good response', async () => {
    const client = fakeClient(jsonResponse(VALID))
    const traits = await inferTraits(candidate, { client })
    expect(traits.moisture).toBe('moist')
    expect(traits.confidence.min_hardiness_zone).toBe('low')
  })

  it('throws RefusalError on a safety refusal', async () => {
    const client = fakeClient({ stop_reason: 'refusal', content: [] })
    await expect(inferTraits(candidate, { client })).rejects.toBeInstanceOf(RefusalError)
  })

  it('rejects an out-of-vocabulary trait value', async () => {
    const client = fakeClient(jsonResponse({ ...VALID, moisture: 'soggy' }))
    await expect(inferTraits(candidate, { client })).rejects.toThrow(/vocabulary|range/i)
  })

  it('rejects an out-of-range hardiness zone (json_schema can not express ranges)', async () => {
    const client = fakeClient(jsonResponse({ ...VALID, min_hardiness_zone: 42 }))
    await expect(inferTraits(candidate, { client })).rejects.toThrow(/vocabulary|range/i)
  })

  it('rejects an empty sun_tolerance array', async () => {
    const client = fakeClient(jsonResponse({ ...VALID, sun_tolerance: [] }))
    await expect(inferTraits(candidate, { client })).rejects.toThrow()
  })

  it('throws a clear error when the response is truncated (stop_reason=max_tokens)', async () => {
    // Adaptive thinking can consume the token budget before the JSON is emitted.
    const client = fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '' }] })
    await expect(inferTraits(candidate, { client })).rejects.toThrow(/max_tokens|truncated/i)
  })

  it('throws a clear error on unparseable JSON', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })
    await expect(inferTraits(candidate, { client })).rejects.toThrow(/parse/i)
  })

  it('requires a client', async () => {
    await expect(inferTraits(candidate, {})).rejects.toThrow(/client/i)
  })
})

describe('trait schemas', () => {
  it('aiTraitsSchema accepts the valid sample', () => {
    expect(aiTraitsSchema.safeParse(VALID).success).toBe(true)
  })

  it('the json_schema locks enums for the survival-critical fields', () => {
    expect(traitsJsonSchema.properties.moisture.enum).toEqual(['dry', 'moist', 'wet'])
    expect(traitsJsonSchema.properties.confidence.properties.sun_tolerance.enum).toEqual([
      'high',
      'medium',
      'low',
    ])
    expect(traitsJsonSchema.additionalProperties).toBe(false)
  })
})
