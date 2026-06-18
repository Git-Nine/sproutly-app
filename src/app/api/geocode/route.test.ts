import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

import { POST } from './route'

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function nominatimResponse(address: Record<string, unknown>) {
  return { ok: true, json: async () => ({ address }) } as unknown as Response
}

describe('POST /api/geocode', () => {
  beforeEach(() => {
    getUser.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when there is no session (auth check)', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await POST(req({ lat: 52.52, lng: 13.405 }))

    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid coordinates', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const res = await POST(req({ lat: 999, lng: 13.405 }))

    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-JSON body', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const res = await POST(req('not json', { raw: true }))

    expect(res.status).toBe(400)
  })

  it('returns the German postcode (happy path)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.mocked(fetch).mockResolvedValue(
      nominatimResponse({ country_code: 'de', postcode: '10115' }),
    )

    const res = await POST(req({ lat: 52.52, lng: 13.405 }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ postcode: '10115' })
  })

  it('discards a non-Germany result', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.mocked(fetch).mockResolvedValue(
      nominatimResponse({ country_code: 'fr', postcode: '75001' }),
    )

    const res = await POST(req({ lat: 48.8566, lng: 2.3522 }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ postcode: null })
  })

  it('returns null postcode when the German address has no usable PLZ', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.mocked(fetch).mockResolvedValue(nominatimResponse({ country_code: 'de' }))

    const res = await POST(req({ lat: 52.52, lng: 13.405 }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ postcode: null })
  })

  it('falls back to null on an upstream failure', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    const res = await POST(req({ lat: 52.52, lng: 13.405 }))

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ postcode: null })
  })
})
