import { describe, it, expect } from 'vitest'
import {
  normalizeLicense,
  isNativeEstablishment,
  gbifMatchSpecies,
  gbifNativeStatus,
  fetchWikidataGermanName,
} from './sources.mjs'

/** Build a fake fetch that returns the given JSON for any URL matching a substring.
 *  Cast to `typeof fetch` because the source clients infer `fetchImpl: typeof fetch`
 *  from their default parameter. */
function fakeFetch(
  routes: Array<{ match: string; json?: unknown; ok?: boolean; status?: number }>,
): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => url.includes(r.match))
    if (!route) throw new Error(`unexpected URL: ${url}`)
    return {
      ok: route.ok ?? true,
      status: route.status ?? 200,
      statusText: 'OK',
      json: async () => route.json,
    }
  }) as unknown as typeof fetch
}

const boomFetch = (async () => {
  throw new Error('ECONNREFUSED')
}) as unknown as typeof fetch

describe('normalizeLicense', () => {
  it('accepts CC0 / CC-BY / CC-BY-SA and rejects the rest', () => {
    expect(normalizeLicense('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0-1.0')
    expect(normalizeLicense('http://creativecommons.org/licenses/by/4.0/')).toBe('CC-BY-4.0')
    expect(normalizeLicense('http://creativecommons.org/licenses/by-sa/4.0/')).toBe('CC-BY-SA-4.0')
    expect(normalizeLicense('http://creativecommons.org/licenses/by-nc/4.0/')).toBeNull()
    expect(normalizeLicense(null)).toBeNull()
  })
})

describe('isNativeEstablishment', () => {
  it('is true only for NATIVE', () => {
    expect(isNativeEstablishment('NATIVE')).toBe(true)
    expect(isNativeEstablishment('Native')).toBe(true)
    expect(isNativeEstablishment('INTRODUCED')).toBe(false)
    expect(isNativeEstablishment(null)).toBe(false)
  })
})

describe('gbifMatchSpecies', () => {
  it('returns the matched taxon', async () => {
    const fetchImpl = fakeFetch([
      { match: '/species/match', json: { matchType: 'EXACT', usageKey: 42, canonicalName: 'Acer campestre', scientificName: 'Acer campestre L.', status: 'ACCEPTED' } },
    ])
    const m = await gbifMatchSpecies('Acer campestre', { fetchImpl })
    expect(m).toMatchObject({ usageKey: 42, canonicalName: 'Acer campestre' })
  })

  it('returns null when GBIF has no match', async () => {
    const fetchImpl = fakeFetch([{ match: '/species/match', json: { matchType: 'NONE' } }])
    expect(await gbifMatchSpecies('Nonexistent species', { fetchImpl })).toBeNull()
  })

  it('throws loudly on a network failure', async () => {
    await expect(gbifMatchSpecies('Acer campestre', { fetchImpl: boomFetch })).rejects.toThrow(/network/i)
  })

  it('throws when the response shape changed', async () => {
    const fetchImpl = fakeFetch([{ match: '/species/match', json: { unexpected: true } }])
    await expect(gbifMatchSpecies('Acer campestre', { fetchImpl })).rejects.toThrow(/matchType/)
  })
})

describe('gbifNativeStatus', () => {
  it('reports native only when the German distribution is on a redistributable dataset', async () => {
    const fetchImpl = fakeFetch([
      { match: '/distributions', json: { results: [{ country: 'DE', establishmentMeans: 'NATIVE', datasetKey: 'ds1' }] } },
      { match: '/dataset/ds1', json: { license: 'http://creativecommons.org/licenses/by/4.0/' } },
    ])
    const r = await gbifNativeStatus(42, { fetchImpl })
    expect(r).toMatchObject({ native: true, license: 'CC-BY-4.0' })
  })

  it('does not claim native when the dataset licence is not redistributable', async () => {
    const fetchImpl = fakeFetch([
      { match: '/distributions', json: { results: [{ country: 'DE', establishmentMeans: 'NATIVE', datasetKey: 'ds2' }] } },
      { match: '/dataset/ds2', json: { license: 'http://creativecommons.org/licenses/by-nc/4.0/' } },
    ])
    const r = await gbifNativeStatus(42, { fetchImpl })
    expect(r.native).toBe(false)
    expect(r.license).toBeNull()
  })

  it('returns non-native when there is no German distribution', async () => {
    const fetchImpl = fakeFetch([
      { match: '/distributions', json: { results: [{ country: 'FR', establishmentMeans: 'NATIVE', datasetKey: 'ds3' }] } },
    ])
    const r = await gbifNativeStatus(42, { fetchImpl })
    expect(r.native).toBe(false)
  })
})

describe('fetchWikidataGermanName', () => {
  it('returns the German label when present', async () => {
    const fetchImpl = fakeFetch([
      { match: 'query.wikidata', json: { results: { bindings: [{ commonName: { value: 'Feldahorn' } }] } } },
    ])
    expect(await fetchWikidataGermanName('Acer campestre', { fetchImpl })).toBe('Feldahorn')
  })

  it('returns null (never throws) when the lookup fails', async () => {
    expect(await fetchWikidataGermanName('Acer campestre', { fetchImpl: boomFetch })).toBeNull()
  })
})
