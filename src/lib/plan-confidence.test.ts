import { describe, it, expect } from 'vitest'
import {
  BAND_RANK,
  RAINFALL_HIGH_MIN_MM,
  RAINFALL_LOW_MAX_MM,
  moistureConflicts,
  plantConfidence,
  rainfallLevel,
  siteGaps,
  summarizePlanConfidence,
  type ConfidencePlant,
  type ConfidenceSite,
} from './plan-confidence'

/**
 * PROJ-13 band model at the logic layer — every Acceptance Criteria band rule:
 * mismatches force "worth_checking" and are un-offsettable; one un-offset gap =
 * "good", two = "worth_checking"; boosts offset one gap each and never penalize
 * by absence; missing data is skipped, never guessed; headline = majority band
 * with explicit exceptions.
 */

/** A fully verified, clean catalogue plant (curated, native, low-maintenance). */
function plant(over: Partial<ConfidencePlant> = {}): ConfidencePlant {
  return {
    soil_compatibility: ['loam', 'sand'],
    maintenance_level: 'low',
    native: false,
    moisture: 'moist',
    ai_origin_fields: null,
    ...over,
  }
}

/** A fully enriched site: soil + zone confirmed, GPS location, medium rainfall. */
function site(over: Partial<ConfidenceSite> = {}): ConfidenceSite {
  return {
    soil: 'loam',
    zone: 7,
    rainfallMm: 800,
    locationBasis: 'gps',
    maintenance: null,
    ...over,
  }
}

describe('rainfallLevel buckets', () => {
  it('buckets at the documented DWD-derived thresholds (boundaries inclusive)', () => {
    expect(rainfallLevel(450)).toBe('low')
    expect(rainfallLevel(RAINFALL_LOW_MAX_MM)).toBe('low')
    expect(rainfallLevel(RAINFALL_LOW_MAX_MM + 1)).toBe('medium')
    expect(rainfallLevel(RAINFALL_HIGH_MIN_MM - 1)).toBe('medium')
    expect(rainfallLevel(RAINFALL_HIGH_MIN_MM)).toBe('high')
    expect(rainfallLevel(2000)).toBe('high')
  })

  it('only opposite extremes conflict — moist plants and medium sites never do', () => {
    expect(moistureConflicts('dry', 'high')).toBe(true)
    expect(moistureConflicts('wet', 'low')).toBe(true)
    expect(moistureConflicts('dry', 'low')).toBe(false)
    expect(moistureConflicts('wet', 'high')).toBe(false)
    expect(moistureConflicts('moist', 'low')).toBe(false)
    expect(moistureConflicts('moist', 'high')).toBe(false)
    expect(moistureConflicts('dry', 'medium')).toBe(false)
    expect(moistureConflicts('wet', 'medium')).toBe(false)
  })
})

describe('plantConfidence — high confidence', () => {
  it('clean plant on a fully known site → high, naming the matched factors', () => {
    const r = plantConfidence(plant(), site())
    expect(r.band).toBe('high')
    expect(r.mismatches).toEqual([])
    expect(r.gaps).toEqual([])
    expect(r.matches).toEqual(
      expect.arrayContaining(['sun-match', 'soil-match', 'zone-match', 'moisture-match']),
    )
  })

  it('non-native, maintenance-mismatched plant with clean data is still high (no penalty for absent boosts)', () => {
    const r = plantConfidence(
      plant({ native: false, maintenance_level: 'high' }),
      site({ maintenance: 'low' }),
    )
    expect(r.band).toBe('high')
    expect(r.offsets).toEqual([])
  })
})

describe('plantConfidence — known mismatches (heavy, un-offsettable)', () => {
  it('soil mismatch forces worth_checking regardless of boosts', () => {
    const r = plantConfidence(
      plant({ soil_compatibility: ['sand'], native: true, maintenance_level: 'low' }),
      site({ soil: 'clay', maintenance: 'low' }),
    )
    expect(r.band).toBe('worth_checking')
    expect(r.mismatches).toEqual(['soil-mismatch'])
    expect(r.offsets).toEqual([]) // boosts never mask a mismatch
  })

  it('a dry-loving plant on a high-rainfall site conflicts on moisture', () => {
    const r = plantConfidence(plant({ moisture: 'dry' }), site({ rainfallMm: 1400 }))
    expect(r.band).toBe('worth_checking')
    expect(r.mismatches).toEqual(['moisture-conflict'])
  })

  it('a wet-loving plant on a low-rainfall site conflicts on moisture', () => {
    const r = plantConfidence(plant({ moisture: 'wet' }), site({ rainfallMm: 500 }))
    expect(r.mismatches).toEqual(['moisture-conflict'])
  })
})

describe('plantConfidence — data gaps and offsets', () => {
  it('one un-offset gap → good (site soil unknown, no boosts)', () => {
    const r = plantConfidence(plant(), site({ soil: null }))
    expect(r.band).toBe('good')
    expect(r.gaps).toEqual(['soil-unknown'])
  })

  it('native boost offsets a single gap → high (unknown soil + native plant)', () => {
    const r = plantConfidence(plant({ native: true }), site({ soil: null }))
    expect(r.band).toBe('high')
    expect(r.gaps).toEqual(['soil-unknown']) // the gap stays visible — honesty
    expect(r.offsets).toEqual(['native-offset'])
  })

  it('two gaps with no boost → worth_checking (unverified AI traits + postcode location)', () => {
    const r = plantConfidence(
      plant({ ai_origin_fields: ['moisture'] }),
      site({ locationBasis: 'postcode_centroid' }),
    )
    expect(r.band).toBe('worth_checking')
    expect(r.gaps).toEqual(['traits-unverified', 'location-approximate'])
  })

  it('two gaps, one boost → good (one gap left un-offset)', () => {
    const r = plantConfidence(
      plant({ native: true, ai_origin_fields: ['moisture'] }),
      site({ soil: null }),
    )
    expect(r.band).toBe('good')
    expect(r.offsets).toEqual(['native-offset'])
  })

  it('two gaps, two boosts (native + maintenance match) → high', () => {
    const r = plantConfidence(
      plant({ native: true, maintenance_level: 'low', ai_origin_fields: ['moisture'] }),
      site({ soil: null, maintenance: 'low' }),
    )
    expect(r.band).toBe('high')
    expect(r.offsets).toEqual(['native-offset', 'maintenance-offset'])
  })

  it('never consumes more boosts than there are gaps', () => {
    const r = plantConfidence(
      plant({ native: true, maintenance_level: 'low' }),
      site({ zone: null, maintenance: 'low' }),
    )
    expect(r.band).toBe('high')
    expect(r.offsets).toEqual(['native-offset']) // one gap → one offset
  })

  it('zone unconfirmed and postcode-centroid location each count as a gap', () => {
    const r = plantConfidence(plant(), site({ zone: null, locationBasis: 'postcode_centroid' }))
    expect(r.band).toBe('worth_checking')
    expect(r.gaps).toEqual(['zone-unconfirmed', 'location-approximate'])
  })
})

describe('plantConfidence — missing data is skipped, never guessed', () => {
  it('a hand-seeded plant without a moisture trait is not evaluated on moisture', () => {
    const r = plantConfidence(plant({ moisture: null }), site())
    expect(r.band).toBe('high')
    expect(r.gaps).toEqual([])
    expect(r.matches).not.toContain('moisture-match')
    expect(r.mismatches).toEqual([])
  })

  it('a plant with the moisture field absent entirely (pre-PROJ-11 shape) is skipped too', () => {
    const p = plant()
    delete (p as { moisture?: unknown }).moisture
    delete (p as { ai_origin_fields?: unknown }).ai_origin_fields
    expect(plantConfidence(p, site()).band).toBe('high')
  })

  it('rainfall unknown (site-level) skips the moisture factor even for a dry plant on paper', () => {
    const r = plantConfidence(plant({ moisture: 'dry' }), site({ rainfallMm: null }))
    expect(r.mismatches).toEqual([])
    expect(r.gaps).toEqual([]) // not a per-plant gap — site-level, per the spec
  })

  it('location basis null (pre-PROJ-13 plan) is neither gap nor match', () => {
    const r = plantConfidence(plant(), site({ locationBasis: null }))
    expect(r.band).toBe('high')
    expect(r.gaps).toEqual([])
  })

  it('empty ai_origin_fields array counts as verified (no gap)', () => {
    const r = plantConfidence(plant({ ai_origin_fields: [] }), site())
    expect(r.gaps).toEqual([])
  })
})

describe('plantConfidence — determinism and wording-free output', () => {
  it('same inputs → identical output', () => {
    const p = plant({ native: true, ai_origin_fields: ['soil_compatibility'] })
    const s = site({ soil: null, locationBasis: 'postcode_centroid' })
    expect(plantConfidence(p, s)).toEqual(plantConfidence(p, s))
  })

  it('returns only machine-readable codes — no prose, no percentages', () => {
    const r = plantConfidence(plant({ moisture: 'dry' }), site({ rainfallMm: 1500, soil: null }))
    const all = [...r.mismatches, ...r.gaps, ...r.offsets, ...r.matches]
    for (const code of all) {
      expect(code).toMatch(/^[a-z-]+$/)
      expect(code).not.toMatch(/%|\d/)
    }
  })
})

describe('siteGaps (headline attribution)', () => {
  it('lists exactly the site-level gaps', () => {
    expect(siteGaps(site())).toEqual([])
    expect(siteGaps(site({ soil: null, zone: null, locationBasis: 'postcode_centroid' }))).toEqual([
      'soil-unknown',
      'zone-unconfirmed',
      'location-approximate',
    ])
  })
})

describe('summarizePlanConfidence (plan headline)', () => {
  it('returns null for an empty plan — a band on nothing is noise', () => {
    expect(summarizePlanConfidence([])).toBeNull()
  })

  it('all-high plan → high with no exceptions', () => {
    const s = summarizePlanConfidence(['high', 'high', 'high'])!
    expect(s.band).toBe('high')
    expect(s.exceptions).toEqual([])
    expect(s.total).toBe(3)
  })

  it('majority band with explicit exception counts (9 of 11; 2 worth checking)', () => {
    const bands = [...Array(9).fill('high'), 'worth_checking', 'worth_checking'] as Parameters<
      typeof summarizePlanConfidence
    >[0]
    const s = summarizePlanConfidence(bands)!
    expect(s.band).toBe('high')
    expect(s.counts).toEqual({ high: 9, good: 0, worth_checking: 2 })
    expect(s.exceptions).toEqual([{ band: 'worth_checking', count: 2 }])
  })

  it('ties go to the lower-confidence band (never oversell)', () => {
    const s = summarizePlanConfidence(['high', 'high', 'good', 'good'])!
    expect(s.band).toBe('good')
    expect(s.exceptions).toEqual([{ band: 'high', count: 2 }])
  })

  it('lists exceptions least-confident first', () => {
    const s = summarizePlanConfidence(['good', 'good', 'high', 'worth_checking'])!
    expect(s.band).toBe('good')
    expect(s.exceptions).toEqual([
      { band: 'worth_checking', count: 1 },
      { band: 'high', count: 1 },
    ])
  })
})

describe('BAND_RANK', () => {
  it('orders bands most-confident first for the engine sort', () => {
    expect(BAND_RANK.high).toBeLessThan(BAND_RANK.good)
    expect(BAND_RANK.good).toBeLessThan(BAND_RANK.worth_checking)
  })
})
