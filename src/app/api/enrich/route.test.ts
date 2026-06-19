import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock functions (available inside vi.mock factories) ──────────────

const {
  getUser,
  scanMaybeSingle, scanEqUserId, scanEqId, scanSelect, scanFrom,
  adminUpsert, adminMaybeSingle, adminEqScanId, adminSelect, adminFrom,
  mockFetchSoilType,
  mockFetchGrid, mockGridValueAt,
} = vi.hoisted(() => {
  const scanMaybeSingle = vi.fn()
  const scanEqUserId = vi.fn(() => ({ maybeSingle: scanMaybeSingle }))
  const scanEqId = vi.fn(() => ({ eq: scanEqUserId }))
  const scanSelect = vi.fn(() => ({ eq: scanEqId }))
  const scanFrom = vi.fn(() => ({ select: scanSelect }))

  const adminUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const adminMaybeSingle = vi.fn()
  const adminEqScanId = vi.fn(() => ({ maybeSingle: adminMaybeSingle }))
  const adminSelect = vi.fn(() => ({ eq: adminEqScanId }))
  const adminFrom = vi.fn(() => ({ upsert: adminUpsert, select: adminSelect }))

  return {
    getUser: vi.fn(),
    scanMaybeSingle, scanEqUserId, scanEqId, scanSelect, scanFrom,
    adminUpsert, adminMaybeSingle, adminEqScanId, adminSelect, adminFrom,
    mockFetchSoilType: vi.fn(),
    mockFetchGrid: vi.fn(),
    mockGridValueAt: vi.fn(),
  }
})

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
    from: scanFrom,
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFrom })),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    // Run after() synchronously in tests so we can assert on the 202 response
    // without waiting for the background work. Enrichment logic is tested
    // separately through runEnrichment() below.
    after: vi.fn(() => undefined),
  }
})

vi.mock('@/lib/bgr', () => ({ fetchSoilType: mockFetchSoilType }))

vi.mock('@/lib/dwd-grid', () => ({
  fetchGrid: mockFetchGrid,
  gridValueAt: mockGridValueAt,
}))

// ─── Import route after mocks ────────────────────────────────────────────────

import { POST, runEnrichment } from './route'

// ─── Shared test data ─────────────────────────────────────────────────────────

const SCAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'
const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'

const SCAN_DE = { id: SCAN_ID, user_id: USER_ID, postcode: '10115', lat: 52.52, lng: 13.405 }
const SCAN_ABROAD = { id: SCAN_ID, user_id: USER_ID, postcode: null, lat: 48.85, lng: 2.35 }
const SCAN_NO_GPS = { id: SCAN_ID, user_id: USER_ID, postcode: '10115', lat: null, lng: null }

const REQUESTED_AT = '2026-06-19T12:00:00.000Z'

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function mockStillCurrent() {
  adminMaybeSingle.mockResolvedValue({ data: { requested_at: REQUESTED_AT } })
}

function mockDwdSuccess() {
  const fakeGrid = { ncols: 1, nrows: 1, xllcorner: 0, yllcorner: 0, cellsize: 1, nodata: -999, values: new Float32Array([0]) }
  mockFetchGrid.mockResolvedValue(fakeGrid)
  // Called 3× (precipitation, minTemp, frostDays) via gridValueAt
  mockGridValueAt
    .mockReturnValueOnce(6400)  // precipitation: 6400 raw → 640 mm/yr
    .mockReturnValueOnce(-85)   // minTemp: -85 raw → -8.5 °C
    .mockReturnValueOnce(45)    // frostDays: 45 days/yr
}

// ─── HTTP layer tests (via POST handler) ─────────────────────────────────────

describe('POST /api/enrich — HTTP layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminUpsert.mockResolvedValue({ data: null, error: null })
  })

  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(401)
    expect(adminUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-JSON body', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req('not json', { raw: true }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when scan_id is missing', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req({}))

    expect(res.status).toBe(400)
  })

  it('returns 400 when scan_id is not a valid UUID', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req({ scan_id: 'not-a-uuid' }))

    expect(res.status).toBe(400)
  })

  it('returns 403 when the scan does not belong to the user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    scanMaybeSingle.mockResolvedValue({ data: null, error: null })

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(403)
    expect(adminUpsert).not.toHaveBeenCalled()
  })

  it('returns 202 and marks enrichment pending when all checks pass', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    scanMaybeSingle.mockResolvedValue({ data: SCAN_DE, error: null })

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ ok: true, status: 'pending' })

    // The initial pending upsert must have been written.
    expect(adminUpsert).toHaveBeenCalledOnce()
    expect(adminUpsert.mock.calls[0][0]).toMatchObject({
      scan_id: SCAN_ID,
      user_id: USER_ID,
      status: 'pending',
      soil_status: 'pending',
      climate_status: 'pending',
      zone_status: 'pending',
    })
  })

  it('returns 500 when the initial upsert fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    scanMaybeSingle.mockResolvedValue({ data: SCAN_DE, error: null })
    adminUpsert.mockResolvedValue({ data: null, error: { message: 'db error' } })

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(500)
  })
})

// ─── Enrichment logic tests (via runEnrichment directly) ─────────────────────

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

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '52.52', lon: '13.405' }],
    }))

    await runEnrichment({ scan: SCAN_NO_GPS, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write).toMatchObject({ location_basis: 'postcode_centroid', soil_status: 'success' })

    vi.unstubAllGlobals()
  })

  it('writes failed status when postcode geocoding fails and no GPS is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => [] }))

    await runEnrichment({ scan: SCAN_NO_GPS, userId: USER_ID, requestedAt: REQUESTED_AT })

    const write = adminUpsert.mock.calls[0][0] as Record<string, unknown>
    expect(write.status).toBe('failed')

    vi.unstubAllGlobals()
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
