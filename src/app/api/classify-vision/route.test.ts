import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mock functions (available inside vi.mock factories) ──────────────

const { getUser, createSignedUrl, storageFrom } = vi.hoisted(() => {
  const createSignedUrl = vi.fn()
  const storageFrom = vi.fn(() => ({ createSignedUrl }))
  return {
    getUser: vi.fn(),
    createSignedUrl,
    storageFrom,
  }
})

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: storageFrom } })),
}))

// ─── Import route after mocks ────────────────────────────────────────────────

import { POST, callClassifier } from './route'

// ─── Shared test data ─────────────────────────────────────────────────────────

const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'
const PHOTO_PATH = `${USER_ID}/scans/aaaaaaaa-0000-4000-a000-000000000001/photo`
const SIGNED_URL = 'https://supabase.example/storage/v1/object/sign/photos/x?token=abc'
const WEBHOOK_URL = 'https://n8n.example/webhook/scan-vision'
const SECRET = 'test-secret'

const OK_FIELDS = {
  surface: 'gravel',
  space_type: 'front_garden',
  sun_exposure: 'partial',
  area_sqm: 8,
}
const OK_RESPONSE = { status: 'ok', fields: OK_FIELDS, confidence: 0.82, message: 'clear' }

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/classify-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function mockN8nJson(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  )
}

// ─── HTTP layer tests (via POST handler) ─────────────────────────────────────

describe('POST /api/classify-vision — HTTP layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.N8N_CLASSIFY_WEBHOOK_URL = WEBHOOK_URL
    process.env.N8N_CLASSIFY_SECRET = SECRET
    createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await POST(req({ photo_path: PHOTO_PATH }))

    expect(res.status).toBe(401)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-JSON body', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req('not json', { raw: true }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when photo_path is missing', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req({}))

    expect(res.status).toBe(400)
  })

  it('returns 400 when postcode is malformed', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req({ photo_path: PHOTO_PATH, postcode: 'abc' }))

    expect(res.status).toBe(400)
  })

  it("returns 403 when photo_path is outside the caller's namespace", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

    const res = await POST(req({ photo_path: 'someone-else/scans/x/photo' }))

    expect(res.status).toBe(403)
    // Must never mint a signed URL for another user's object.
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('mints a 120s signed URL for the given path and returns the ok contract', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    mockN8nJson(OK_RESPONSE)

    const res = await POST(req({ photo_path: PHOTO_PATH, postcode: '10115' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'ok', fields: OK_FIELDS })
    expect(storageFrom).toHaveBeenCalledWith('photos')
    expect(createSignedUrl).toHaveBeenCalledWith(PHOTO_PATH, 120)
  })

  it('degrades to a fallback contract (200) when the signed URL cannot be minted', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(req({ photo_path: PHOTO_PATH }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'low_confidence', fields: null })
    // n8n must not be called if we have no URL to classify.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('degrades to a fallback contract (200) when n8n env vars are not set', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    delete process.env.N8N_CLASSIFY_WEBHOOK_URL
    delete process.env.N8N_CLASSIFY_SECRET

    const res = await POST(req({ photo_path: PHOTO_PATH }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'low_confidence', fields: null })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

// ─── Classifier call tests (via callClassifier directly) ─────────────────────

describe('callClassifier', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  const args = {
    webhookUrl: WEBHOOK_URL,
    secret: SECRET,
    photoUrl: SIGNED_URL,
    postcode: '10115',
    scanDraftId: null,
  }

  it('sends the secret header and the correct body, returns a validated ok result', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => OK_RESPONSE })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await callClassifier(args)

    expect(result).toMatchObject({ status: 'ok', fields: OK_FIELDS })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect((init.headers as Record<string, string>)['x-sproutly-secret']).toBe(SECRET)
    expect(JSON.parse(init.body as string)).toEqual({
      scan_draft_id: null,
      photo_url: SIGNED_URL,
      postcode: '10115',
    })
  })

  it('passes through a rejected result with null fields', async () => {
    mockN8nJson({ status: 'rejected', fields: null, message: 'indoor' })

    const result = await callClassifier(args)

    expect(result).toMatchObject({ status: 'rejected', fields: null })
  })

  it('falls back when n8n returns a non-2xx status', async () => {
    mockN8nJson({}, { ok: false, status: 502 })

    const result = await callClassifier(args)

    expect(result.status).toBe('low_confidence')
    expect(result.fields).toBeNull()
  })

  it('falls back when the response is off-schema (bad enum token)', async () => {
    mockN8nJson({ status: 'ok', fields: { ...OK_FIELDS, surface: 'concrete' }, confidence: 0.9 })

    const result = await callClassifier(args)

    expect(result.status).toBe('low_confidence')
    expect(result.fields).toBeNull()
  })

  it('falls back when status is ok but fields are missing (defense in depth)', async () => {
    mockN8nJson({ status: 'ok', fields: null, confidence: 0.9 })

    const result = await callClassifier(args)

    expect(result.status).toBe('low_confidence')
    expect(result.fields).toBeNull()
  })

  it('falls back when the fetch throws (network error / timeout abort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))

    const result = await callClassifier(args)

    expect(result.status).toBe('low_confidence')
    expect(result.fields).toBeNull()
  })
})
