import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { forwardGeocodePostcode, reverseGeocodeToPostcode } from './nominatim'

describe('nominatim client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('forwardGeocodePostcode', () => {
    it('returns the centroid coordinates for a resolvable postcode', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '52.52', lon: '13.405' }],
      } as unknown as Response)

      await expect(forwardGeocodePostcode('10115')).resolves.toEqual({
        lat: 52.52,
        lng: 13.405,
      })
      // Usage policy: the identifying User-Agent must be sent.
      const [, init] = vi.mocked(fetch).mock.calls[0]
      expect((init?.headers as Record<string, string>)['User-Agent']).toContain('Sproutly')
    })

    it('returns null when there is no match', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [],
      } as unknown as Response)

      await expect(forwardGeocodePostcode('00000')).resolves.toBeNull()
    })

    it('returns null on an upstream failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('network down'))

      await expect(forwardGeocodePostcode('10115')).resolves.toBeNull()
    })
  })

  describe('reverseGeocodeToPostcode', () => {
    function nominatimResponse(address: Record<string, unknown>) {
      return { ok: true, json: async () => ({ address }) } as unknown as Response
    }

    it('returns the German postcode (happy path)', async () => {
      vi.mocked(fetch).mockResolvedValue(
        nominatimResponse({ country_code: 'de', postcode: '10115' }),
      )

      await expect(reverseGeocodeToPostcode(52.52, 13.405)).resolves.toEqual({
        ok: true,
        postcode: '10115',
      })
    })

    it('discards a non-Germany result but reports the lookup as ok', async () => {
      vi.mocked(fetch).mockResolvedValue(
        nominatimResponse({ country_code: 'fr', postcode: '75001' }),
      )

      await expect(reverseGeocodeToPostcode(48.8566, 2.3522)).resolves.toEqual({
        ok: true,
        postcode: null,
      })
    })

    it('returns ok with null postcode when the German address has no usable PLZ', async () => {
      vi.mocked(fetch).mockResolvedValue(nominatimResponse({ country_code: 'de' }))

      await expect(reverseGeocodeToPostcode(52.52, 13.405)).resolves.toEqual({
        ok: true,
        postcode: null,
      })
    })

    it('reports an upstream failure as not ok', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('network down'))

      await expect(reverseGeocodeToPostcode(52.52, 13.405)).resolves.toEqual({
        ok: false,
        postcode: null,
      })
    })
  })
})
