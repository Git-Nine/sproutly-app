import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock functions (available inside vi.mock factories) ──────────────

const {
  adminUpsert, adminMaybeSingle, adminEqScanId, adminSelect, adminFrom,
  mockFetchSoilType,
  mockFetchGrid, mockGridValueAt,
  mockForwardGeocode,
} = vi.hoisted(() => {
  const adminUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const adminMaybeSingle = vi.fn()
  const adminEqScanId = vi.fn(() => ({ maybeSingle: adminMaybeSingle }))
  const adminSelect = vi.fn(() => ({ eq: adminEqScanId }))
  const adminFrom = vi.fn(() => ({ upsert: adminUpsert, select: adminSelect }))

  return {
    adminUpsert, adminMaybeSingle, adminEqScanId, adminSelect, adminFrom,
    mockFetchSoilType: vi.fn(),
    mockFetchGrid: vi.fn(),
    mockGridValueAt: vi.fn(),
    mockForwardGeocode: vi.fn(),
  }
})

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFrom })),
}))

vi.mock('@/lib/bgr', () => ({ fetchSoilType: mockFetchSoilType }))

vi.mock('@/lib/dwd-grid', () => ({
  fetchGrid: mockFetchGrid,
  gridValueAt: mockGridValueAt,
}))

vi.mock('@/lib/nominatim', () => ({
  forwardGeocodePostcode: mockForwardGeocode,
}))

import { runEnrichment } from './run'

// ─── Shared test data ─────────────────────────────────────────────────────────

const SCAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'
const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'

const SCAN_DE = { id: SCAN_ID, user_id: USER_ID, postcode: '10115', lat: 52.52, lng: 13.405 }
const SCAN_ABROAD = { id: SCAN_ID, user_id: USER_ID, postcode: null, lat: 48.85, lng: 2.35 }
const SCAN_NO_GPS = { id: SCAN_ID, user_id: USER_ID, postcode: '10115', lat: null, lng: null }

const REQUESTED_AT = '2026-06-19T12:00:00.000Z'

function mockStillCurrent() {
  adminMaybeSingle.mockResolvedValue({ data: { requested_at: REQUESTED_AT } })
}

function mockDwdSuccess() {
  const fakeGrid = { ncols: 1, nrows: 1, xllcorner: 0, yllcorner: 0, cellsize: 1, nodata: -999, values: new Float32Array([0]) }
  mockFetchGrid.mockResolvedValue(fakeGrid)
  // Called 3× (precipitation, minTemp, frostDays) via gridValueAt
  mockGridValueAt
    .mockReturnValueOnce(640)   // precipitation: 640 mm raw (scale=1) → 640 mm/yr
    .mockReturnValueOnce(-85)   // minTemp: -85 raw → -8.5 °C
    .mockReturnValueOnce(45)    // frostDays: 45 days/yr
}

describe('runEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminUpsert.mockResolvedValue({ data: null, error: null })
  })

  it('writes complete status when all sources succeed', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue('loam')
    mockDwdSuccess()

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({
      scan_id: SCAN_ID,
      status: 'complete',
      soil_type: 'loam',
      soil_status: 'success',
      rainfall_mm: 640,
      annual_min_temp: -8.5,
      frost_days: 45,
      climate_status: 'success',
      climate_period: '1991–2020',
      hardiness_zone: '9',  // -8.5 °C → zone 9 (< -7 °C)
      zone_status: 'success',
      location_basis: 'gps',
    })
  })

  it('writes partial status when soil fails but climate succeeds', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue(null)
    mockDwdSuccess()

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({
      status: 'partial',
      soil_status: 'unavailable',
      climate_status: 'success',
      zone_status: 'success',
    })
  })

  it('writes failed status when all sources fail', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue(null)
    mockFetchGrid.mockResolvedValue(null)

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({
      status: 'failed',
      soil_status: 'unavailable',
      climate_status: 'unavailable',
    })
  })

  it('marks all fields unavailable for non-Germany coordinates, skips external APIs', async () => {
    mockStillCurrent()

    await runEnrichment({ scan: SCAN_ABROAD, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({
      status: 'complete',
      soil_status: 'unavailable',
      climate_status: 'unavailable',
      zone_status: 'unavailable',
    })
    expect(mockFetchSoilType).not.toHaveBeenCalled()
    expect(mockFetchGrid).not.toHaveBeenCalled()
  })

  it('forward-geocodes the postcode when no GPS is present', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue('sand')
    mockDwdSuccess()
    mockForwardGeocode.mockResolvedValue({ lat: 52.52, lng: 13.405 })

    await runEnrichment({ scan: SCAN_NO_GPS, userId: USER_ID, requestedAt: REQUESTED_AT })

    expect(mockForwardGeocode).toHaveBeenCalledWith('10115')
    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({ location_basis: 'postcode_centroid', soil_status: 'success' })
  })

  it('writes failed status when postcode geocoding fails and no GPS is available', async () => {
    mockForwardGeocode.mockResolvedValue(null)

    await runEnrichment({ scan: SCAN_NO_GPS, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write.status).toBe('failed')
  })

  // PROJ-13 QA BUG-1: an unsampled precipitation grid must store NO rainfall,
  // not a fabricated 0 mm/yr that the confidence band would bucket as "low"
  // and turn into false moisture-conflict warnings.
  it('stores no rainfall (not 0) when only the precipitation grid fails', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue('loam')
    const fakeGrid = { ncols: 1, nrows: 1, xllcorner: 0, yllcorner: 0, cellsize: 1, nodata: -999, values: new Float32Array([0]) }
    mockFetchGrid.mockResolvedValue(fakeGrid)
    mockGridValueAt
      .mockReturnValueOnce(null)  // precipitation: NODATA / unsampled
      .mockReturnValueOnce(-85)   // minTemp: -8.5 °C
      .mockReturnValueOnce(45)    // frostDays

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write.rainfall_mm).toBeUndefined() // column stays NULL — never 0
    expect(write.status).toBe('partial')      // honest: retry stays reachable
    expect(write).toMatchObject({
      climate_status: 'success',
      hardiness_zone: '9', // the sampled fields still work
      zone_status: 'success',
    })
  })

  // PROJ-13 QA BUG-2: an unsampled min-temp grid must yield NO zone — the old
  // 0 °C fallback derived zone '10' (mildest) marked as CONFIRMED, silently
  // disabling the PROJ-6 winter hard filter.
  it('stores no hardiness zone when the min-temp grid fails (never a fabricated zone 10)', async () => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue('loam')
    const fakeGrid = { ncols: 1, nrows: 1, xllcorner: 0, yllcorner: 0, cellsize: 1, nodata: -999, values: new Float32Array([0]) }
    mockFetchGrid.mockResolvedValue(fakeGrid)
    mockGridValueAt
      .mockReturnValueOnce(640)   // precipitation
      .mockReturnValueOnce(null)  // minTemp: NODATA / unsampled
      .mockReturnValueOnce(45)    // frostDays

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write.hardiness_zone).toBeUndefined()
    expect(write.annual_min_temp).toBeUndefined()
    expect(write.status).toBe('partial')
    expect(write).toMatchObject({
      rainfall_mm: 640,
      zone_status: 'unavailable', // zone honestly unconfirmed, filter suppressed + labelled
    })
  })

  it('discards results when a newer enrichment has started (stale guard)', async () => {
    // Return a different timestamp → stale; should not call upsert.
    adminMaybeSingle.mockResolvedValue({ data: { requested_at: 'a-different-timestamp' } })
    mockFetchSoilType.mockResolvedValue('clay')
    mockDwdSuccess()

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    expect(adminUpsert).not.toHaveBeenCalled()
  })

  it.each([
    [-30, '5'],
    [-25, '6'],
    [-20, '7'],
    [-14, '8'],
    [-9,  '9'],
    [-3,  '10'],
  ])('derives hardiness zone for annual min %s °C → zone %s', async (minTemp, expectedZone) => {
    mockStillCurrent()
    mockFetchSoilType.mockResolvedValue(null)

    const fakeGrid = { ncols: 1, nrows: 1, xllcorner: 0, yllcorner: 0, cellsize: 1, nodata: -999, values: new Float32Array([0]) }
    mockFetchGrid.mockResolvedValue(fakeGrid)
    mockGridValueAt
      .mockReturnValueOnce(6400)
      .mockReturnValueOnce(minTemp * 10)  // DWD stores ×10
      .mockReturnValueOnce(45)

    await runEnrichment({ scan: SCAN_DE, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write.hardiness_zone).toBe(expectedZone)
  })
})
