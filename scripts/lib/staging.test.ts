import { describe, it, expect } from 'vitest'
import { serializeStagingFile, parseStagingFile } from './staging.mjs'
import { buildStagedRow } from './catalogue.mjs'

const TRAITS = {
  sun_tolerance: ['full'],
  soil_compatibility: ['loam'],
  moisture: 'moist',
  min_hardiness_zone: 5,
  mature_height_cm: 60,
  mature_spread_cm: 40,
  maintenance_level: 'low',
  plant_type: 'perennial',
  care_notes: 'Notes.',
  confidence: { sun_tolerance: 'high', soil_compatibility: 'high', moisture: 'high', min_hardiness_zone: 'high' },
}

const rows = [
  buildStagedRow({ identity: { common_name: 'Alien', latin_name: 'Zeta alien', native: false }, traits: TRAITS, status: 'new' }),
  buildStagedRow({ identity: { common_name: 'Native', latin_name: 'Alpha native', native: true }, traits: TRAITS, status: 'new' }),
]

describe('staging file serialize/parse', () => {
  it('round-trips rows through YAML', () => {
    const text = serializeStagingFile(rows)
    const parsed = parseStagingFile(text)
    expect(parsed).toHaveLength(2)
    const byName = Object.fromEntries(parsed.map((r: { latin_name: string }) => [r.latin_name, r]))
    expect(byName['Alpha native'].moisture).toBe('moist')
    expect(byName['Alpha native'].approved).toBe(false)
  })

  it('writes natives first', () => {
    const parsed = parseStagingFile(serializeStagingFile(rows))
    expect(parsed[0].latin_name).toBe('Alpha native') // native
    expect(parsed[1].latin_name).toBe('Zeta alien') // non-native
  })

  it('includes the curator review instructions as a header comment', () => {
    const text = serializeStagingFile(rows)
    expect(text).toMatch(/HOW TO REVIEW/)
    expect(text).toMatch(/approved: true/)
  })

  it('throws on a file with no plants array (corrupt / wrong file)', () => {
    expect(() => parseStagingFile('something: else')).toThrow(/plants/)
  })

  it('throws on invalid YAML', () => {
    expect(() => parseStagingFile('{ this is: not: valid')).toThrow(/YAML/i)
  })
})
