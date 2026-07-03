import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HTTP-layer tests for POST /api/enrich: auth, validation, ownership, the
 * initial "pending" write, and the background dispatch. The enrichment run
 * itself is tested in src/lib/enrichment/run.test.ts.
 */

// ─── Hoisted mock functions (available inside vi.mock factories) ──────────────

const {
  getUser,
  scanMaybeSingle, scanEqUserId, scanEqId, scanSelect, scanFrom,
  adminUpsert, adminFrom,
  mockRunEnrichment,
} = vi.hoisted(() => {
  const scanMaybeSingle = vi.fn()
  const scanEqUserId = vi.fn(() => ({ maybeSingle: scanMaybeSingle }))
  const scanEqId = vi.fn(() => ({ eq: scanEqUserId }))
  const scanSelect = vi.fn(() => ({ eq: scanEqId }))
  const scanFrom = vi.fn(() => ({ select: scanSelect }))

  const adminUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const adminFrom = vi.fn(() => ({ upsert: adminUpsert }))

  return {
    getUser: vi.fn(),
    scanMaybeSingle, scanEqUserId, scanEqId, scanSelect, scanFrom,
    adminUpsert, adminFrom,
    mockRunEnrichment: vi.fn(),
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
    // Run after()'s callback synchronously in tests so the dispatch is
    // observable without waiting for the background scheduler.
    after: vi.fn((cb: () => unknown) => { void cb() }),
  }
})

vi.mock('@/lib/enrichment/run', () => ({ runEnrichment: mockRunEnrichment }))

// ─── Import route after mocks ────────────────────────────────────────────────

import { POST } from './route'

// ─── Shared test data ─────────────────────────────────────────────────────────

const SCAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'
const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'

const SCAN_DE = { id: SCAN_ID, user_id: USER_ID, postcode: '10115', lat: 52.52, lng: 13.405 }

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

describe('POST /api/enrich — HTTP layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminUpsert.mockResolvedValue({ data: null, error: null })
    mockRunEnrichment.mockResolvedValue(undefined)
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
    expect(mockRunEnrichment).not.toHaveBeenCalled()
  })

  it('returns 202, marks enrichment pending, and dispatches the background run', async () => {
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

    // The background run receives the captured scan + the same requested_at.
    expect(mockRunEnrichment).toHaveBeenCalledOnce()
    expect(mockRunEnrichment.mock.calls[0][0]).toMatchObject({
      scan: SCAN_DE,
      userId: USER_ID,
    })
  })

  it('returns 500 when the initial upsert fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    scanMaybeSingle.mockResolvedValue({ data: SCAN_DE, error: null })
    adminUpsert.mockResolvedValue({ data: null, error: { message: 'db error' } })

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(500)
    expect(mockRunEnrichment).not.toHaveBeenCalled()
  })
})
