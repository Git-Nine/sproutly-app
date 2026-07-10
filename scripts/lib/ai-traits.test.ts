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
  insect_value: 'high',
  bird_value: 'low',
  bloom_start_month: 6,
  bloom_end_month: 9,
  pollinator_friendly: true,
  confidence: {
    sun_tolerance: 'high',
    soil_compatibility: 'high',
    moisture: 'medium',
    min_hardiness_zone: 'low',
    insect_value: 'high',
    bird_value: 'medium',
    bloom_period: 'high',
    pollinator_friendly: 'high',
  },
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

  it('returns the ecological traits + their confidence', async () => {
    const client = fakeClient(jsonResponse(VALID))
    const traits = await inferTraits(candidate, { client })
    expect(traits.insect_value).toBe('high')
    expect(traits.pollinator_friendly).toBe(true)
    expect(traits.bloom_start_month).toBe(6)
    expect(traits.confidence.bloom_period).toBe('high')
  })

  it("accepts 'none' wildlife value and a null bloom pair (non-flowering)", async () => {
    const client = fakeClient(
      jsonResponse({ ...VALID, insect_value: 'none', bird_value: 'none', bloom_start_month: null, bloom_end_month: null }),
    )
    const traits = await inferTraits(candidate, { client })
    expect(traits.insect_value).toBe('none')
    expect(traits.bloom_start_month).toBeNull()
  })

  it('rejects an out-of-vocabulary wildlife band', async () => {
    const client = fakeClient(jsonResponse({ ...VALID, insect_value: 'enormous' }))
    await expect(inferTraits(candidate, { client })).rejects.toThrow(/vocabulary|range/i)
  })

  it('rejects a half-set bloom pair (both or neither)', async () => {
    const client = fakeClient(jsonResponse({ ...VALID, bloom_end_month: null }))
    await expect(inferTraits(candidate, { client })).rejects.toThrow()
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

  it('the json_schema locks the ecological vocabulary + a nullable bloom pair', () => {
    expect(traitsJsonSchema.properties.insect_value.enum).toEqual(['none', 'low', 'medium', 'high'])
    expect(traitsJsonSchema.properties.bird_value.enum).toEqual(['none', 'low', 'medium', 'high'])
    expect(traitsJsonSchema.properties.bloom_start_month.type).toEqual(['integer', 'null'])
    expect(traitsJsonSchema.properties.pollinator_friendly.type).toBe('boolean')
    expect(traitsJsonSchema.properties.confidence.properties.bloom_period.enum).toEqual([
      'high',
      'medium',
      'low',
    ])
  })
})
