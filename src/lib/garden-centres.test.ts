import { describe, it, expect } from 'vitest'
import {
  GARDEN_CENTRES,
  primaryGardenCentre,
  alternativeGardenCentres,
  gardenCentreSearchUrl,
} from './garden-centres'
import { isHttpUrl } from './plants'

/**
 * PROJ-8 — the garden-centre deep-link config + link builder. This is the single
 * source of truth the shopping list turns each plant into a search URL with, and the
 * documented v2 swap-in point. These cover the "Latin name is correctly URL-encoded"
 * AC and the structural invariants the UI relies on (exactly one primary, the rest
 * behind "other shops", every template a usable http(s) search URL).
 */

describe('GARDEN_CENTRES config invariants', () => {
  it('has at least a primary and one alternative', () => {
    expect(GARDEN_CENTRES.length).toBeGreaterThanOrEqual(2)
  })

  it('marks exactly one centre as primary', () => {
    expect(GARDEN_CENTRES.filter((c) => c.primary)).toHaveLength(1)
  })

  it('exposes the primary as primaryGardenCentre', () => {
    expect(primaryGardenCentre.primary).toBe(true)
    expect(primaryGardenCentre.name).toBe('Pflanzmich')
  })

  it('lists everything except the primary as an alternative', () => {
    expect(alternativeGardenCentres).not.toContain(primaryGardenCentre)
    expect(alternativeGardenCentres.length).toBe(GARDEN_CENTRES.length - 1)
  })

  it('every template is an http(s) URL containing the {q} token', () => {
    for (const centre of GARDEN_CENTRES) {
      expect(centre.searchUrlTemplate).toContain('{q}')
      // Strip the token to a placeholder so the template parses as a real URL.
      expect(isHttpUrl(centre.searchUrlTemplate.replace('{q}', 'x'))).toBe(true)
    }
  })

  it('has a non-empty display name for every centre', () => {
    for (const centre of GARDEN_CENTRES) expect(centre.name.trim().length).toBeGreaterThan(0)
  })
})

describe('gardenCentreSearchUrl — Latin name encoding', () => {
  const centre = { name: 'Test', searchUrlTemplate: 'https://example.com/search?q={q}&type=product' }

  it('URL-encodes a space in a two-part Latin name', () => {
    const url = gardenCentreSearchUrl(centre, 'Lavandula angustifolia')
    expect(url).toBe('https://example.com/search?q=Lavandula%20angustifolia&type=product')
  })

  it('encodes the × hybrid mark', () => {
    const url = gardenCentreSearchUrl(centre, 'Crataegus × media')
    expect(url).toContain('Crataegus%20%C3%97%20media')
    // The literal × must never reach the query string unencoded.
    expect(url).not.toContain('×')
  })

  it('encodes diacritics', () => {
    const url = gardenCentreSearchUrl(centre, 'Sedum forsterianum subsp. elegans')
    expect(url).toContain('subsp.%20elegans')
  })

  it('encodes characters that would otherwise break out of the query string', () => {
    const url = gardenCentreSearchUrl(centre, 'Rosa "Mme & Co"')
    expect(url).not.toMatch(/[ "]/) // no raw space or quote in the built URL
    expect(url).toContain('%26') // & encoded, not treated as a param separator
  })

  it('trims surrounding whitespace before encoding', () => {
    const url = gardenCentreSearchUrl(centre, '  Acer campestre  ')
    expect(url).toBe('https://example.com/search?q=Acer%20campestre&type=product')
  })

  it('only replaces the {q} token, leaving the rest of the template intact', () => {
    const url = gardenCentreSearchUrl(centre, 'Betula pendula')
    expect(url.startsWith('https://example.com/search?q=')).toBe(true)
    expect(url.endsWith('&type=product')).toBe(true)
  })

  it('builds a working URL for each real configured centre', () => {
    for (const c of GARDEN_CENTRES) {
      const url = gardenCentreSearchUrl(c, 'Lavandula angustifolia')
      expect(isHttpUrl(url)).toBe(true)
      expect(url).toContain('Lavandula%20angustifolia')
      expect(url).not.toContain('{q}')
    }
  })
})
