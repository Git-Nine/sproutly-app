import { describe, it, expect } from 'vitest'
import { deriveHardinessZone } from './climate'

/**
 * PROJ-4 fix (2026-07-12): the zone was previously derived from the ANNUAL mean
 * of daily minimum temps (~+5 °C everywhere in Germany), which put every site
 * in zone 10 and disabled the PROJ-6 winter hard filter. The mapping now takes
 * the JANUARY mean daily minimum with thresholds calibrated against the
 * published German Winterhärtezonen map.
 */
describe('deriveHardinessZone (January mean daily minimum)', () => {
  // Real 2026-07-12 DWD January grid samples at cities with a published zone.
  it.each([
    ['Oberstdorf', -7.3, '6'],
    ['Garmisch', -5.8, '6'],
    ['Harz', -4.9, '6'],
    ['Passau', -3.5, '7'],
    ['München', -2.2, '7'],
    ['Cottbus', -2.1, '7'],
    ['Erfurt', -2.0, '7'],
    ['Dresden', -1.7, '7'],
    ['Berlin', -1.1, '7'],
    ['Stuttgart', -0.8, '8'],
    ['Freiburg', -0.4, '8'],
    ['Hamburg', -0.2, '8'],
    ['Frankfurt', 0.2, '8'],
    ['Düsseldorf', 0.7, '8'],
    ['Köln', 1.3, '8'],
  ])('%s (%s °C) → published zone %s', (_city, janMeanMin, zone) => {
    expect(deriveHardinessZone(janMeanMin)).toBe(zone)
  })

  it('never derives zone 10 — the signature of the wrong-measure bug', () => {
    // Sweep well past any value the January grid can produce in Germany,
    // including annual-mean-like values (~+5 °C) that caused the original bug.
    for (let t = -20; t <= 10; t += 0.1) {
      expect(deriveHardinessZone(t)).not.toBe('10')
    }
  })

  it('caps at zone 9 for implausibly mild inputs and floors at 5 for alpine cold', () => {
    expect(deriveHardinessZone(8)).toBe('9')
    expect(deriveHardinessZone(-15)).toBe('5')
  })
})
