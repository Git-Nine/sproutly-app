import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Scan, ScanValues } from '@/lib/scans'

vi.mock('@/lib/image', () => ({
  downscaleImage: async (f: File) => f,
}))

import {
  geocodeToPostcode,
  classifyScanPhoto,
  uploadScanPhoto,
  saveScan,
  deleteScan,
  shouldTriggerEnrichment,
  triggerEnrichment,
} from './scans-client'

const USER_ID = 'user-abc'
const SCAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'

const VALUES: ScanValues = {
  name: '  Back garden ',
  postcode: '10115',
  sun_exposure: 'full',
  surface: 'gravel',
  space_type: 'back_garden',
  area_sqm: 20,
}

const EXISTING = {
  id: SCAN_ID,
  short_code: 'Kp3xR9aQ',
  photo_path: `${USER_ID}/scans/${SCAN_ID}/photo`,
  postcode: '10115',
} as unknown as Scan

/** The browser-client type saveScan expects — mocks are cast to it. */
type Client = Parameters<typeof saveScan>[0]

/** A chainable Supabase client mock covering storage + the scans table. */
function mockClient() {
  const upload = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
    .mockResolvedValue({ error: null })
  const remove = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
    .mockResolvedValue({ error: null })
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn<(...args: unknown[]) => { eq: typeof updateEq }>(() => ({ eq: updateEq }))
  const single = vi.fn().mockResolvedValue({ data: { short_code: 'Ab1cD2eF' }, error: null })
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn<(...args: unknown[]) => { select: typeof insertSelect }>(() => ({ select: insertSelect }))
  const deleteEq = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
    .mockResolvedValue({ error: null })
  const del = vi.fn(() => ({ eq: deleteEq }))
  const client = {
    storage: { from: vi.fn(() => ({ upload, remove })) },
    from: vi.fn(() => ({ update, insert, delete: del })),
  } as unknown as Client
  return { client, upload, remove, update, updateEq, insert, single, deleteEq }
}

describe('geocodeToPostcode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the postcode from the geocode route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ postcode: '10115' }) }))
    await expect(geocodeToPostcode(52.52, 13.405)).resolves.toBe('10115')
  })

  it('returns null on an upstream failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await expect(geocodeToPostcode(52.52, 13.405)).resolves.toBeNull()
  })
})

describe('classifyScanPhoto', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the photo path and returns the classification', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', fields: { surface: 'gravel', space_type: 'bed', sun_exposure: 'full', area_sqm: 8 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await classifyScanPhoto({ photoPath: `${USER_ID}/x`, postcode: '10115', scanDraftId: SCAN_ID })

    expect(result?.status).toBe('ok')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ photo_path: `${USER_ID}/x`, postcode: '10115', scan_draft_id: SCAN_ID })
  })

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    await expect(
      classifyScanPhoto({ photoPath: `${USER_ID}/x`, scanDraftId: SCAN_ID }),
    ).resolves.toBeNull()
  })
})

describe('uploadScanPhoto', () => {
  it('uploads to the fixed per-scan path and returns it', async () => {
    const { client, upload } = mockClient()
    const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })

    const path = await uploadScanPhoto(client, { userId: USER_ID, scanId: SCAN_ID, file })

    expect(path).toBe(`${USER_ID}/scans/${SCAN_ID}/photo`)
    expect(upload).toHaveBeenCalledWith(path, file, { upsert: true, contentType: 'image/jpeg' })
  })

  it('throws on an upload error', async () => {
    const { client, upload } = mockClient()
    upload.mockResolvedValue({ error: { message: 'quota exceeded' } })
    const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })

    await expect(
      uploadScanPhoto(client, { userId: USER_ID, scanId: SCAN_ID, file }),
    ).rejects.toMatchObject({ message: 'quota exceeded' })
  })
})

describe('saveScan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new scan with EXIF geo and returns the DB short code', async () => {
    const { client, insert, upload } = mockClient()
    const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })

    const code = await saveScan(client, {
      scanId: SCAN_ID,
      userId: USER_ID,
      existing: null,
      values: VALUES,
      photo: { file, alreadyUploadedPath: null, remove: false },
      exif: { lat: 52.52, lng: 13.405, takenAt: '2026-06-01T10:00:00Z' },
    })

    expect(code).toBe('Ab1cD2eF')
    expect(upload).toHaveBeenCalledOnce() // no prior upload to reuse
    expect(insert.mock.calls[0][0]).toMatchObject({
      id: SCAN_ID,
      user_id: USER_ID,
      name: 'Back garden', // trimmed
      photo_path: `${USER_ID}/scans/${SCAN_ID}/photo`,
      lat: 52.52,
      lng: 13.405,
      taken_at: '2026-06-01T10:00:00Z',
    })
  })

  it('reuses the AI-prefill upload instead of uploading again', async () => {
    const { client, upload, insert } = mockClient()
    const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })
    const uploadedPath = `${USER_ID}/scans/${SCAN_ID}/photo`

    await saveScan(client, {
      scanId: SCAN_ID,
      userId: USER_ID,
      existing: null,
      values: VALUES,
      photo: { file, alreadyUploadedPath: uploadedPath, remove: false },
      exif: null,
    })

    expect(upload).not.toHaveBeenCalled()
    expect(insert.mock.calls[0][0]).toMatchObject({ photo_path: uploadedPath })
  })

  it('updates an existing scan and refreshes geo from a new photo', async () => {
    const { client, update } = mockClient()
    const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })

    const code = await saveScan(client, {
      scanId: SCAN_ID,
      userId: USER_ID,
      existing: EXISTING,
      values: VALUES,
      photo: { file, alreadyUploadedPath: `${USER_ID}/scans/${SCAN_ID}/photo`, remove: false },
      exif: { lat: 48.14, lng: 11.58, takenAt: null },
    })

    expect(code).toBe(EXISTING.short_code)
    expect(update.mock.calls[0][0]).toMatchObject({ lat: 48.14, lng: 11.58, taken_at: null })
  })

  it('removes the stored photo and clears photo-derived geo on removal', async () => {
    const { client, remove, update } = mockClient()

    await saveScan(client, {
      scanId: SCAN_ID,
      userId: USER_ID,
      existing: EXISTING,
      values: VALUES,
      photo: { file: null, alreadyUploadedPath: null, remove: true },
      exif: null,
    })

    expect(remove).toHaveBeenCalledWith([EXISTING.photo_path])
    expect(update.mock.calls[0][0]).toMatchObject({
      photo_path: null,
      lat: null,
      lng: null,
      taken_at: null,
    })
  })

  it('leaves geo untouched when editing without touching the photo', async () => {
    const { client, update } = mockClient()

    await saveScan(client, {
      scanId: SCAN_ID,
      userId: USER_ID,
      existing: EXISTING,
      values: VALUES,
      photo: { file: null, alreadyUploadedPath: null, remove: false },
      exif: null,
    })

    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect('lat' in written).toBe(false)
    expect(written.photo_path).toBe(EXISTING.photo_path)
  })
})

describe('deleteScan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the row FIRST, then removes the photo', async () => {
    const { client, deleteEq, remove } = mockClient()

    await deleteScan(client, { scanId: SCAN_ID, photoPath: 'user/scans/x/photo' })

    expect(deleteEq).toHaveBeenCalledWith('id', SCAN_ID)
    expect(remove).toHaveBeenCalledWith(['user/scans/x/photo'])
    expect(deleteEq.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0])
  })

  it('does not touch the photo when the row delete fails', async () => {
    const { client, deleteEq, remove } = mockClient()
    deleteEq.mockResolvedValue({ error: { message: 'rls denied' } })

    await expect(
      deleteScan(client, { scanId: SCAN_ID, photoPath: 'user/scans/x/photo' }),
    ).rejects.toMatchObject({ message: 'rls denied' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('treats photo cleanup as best-effort — a storage error does not fail the delete', async () => {
    const { client, remove } = mockClient()
    remove.mockResolvedValue({ error: { message: 'storage down' } })

    await expect(
      deleteScan(client, { scanId: SCAN_ID, photoPath: 'user/scans/x/photo' }),
    ).resolves.toBeUndefined()
  })

  it('skips storage entirely for a scan without a photo', async () => {
    const { client, remove } = mockClient()

    await deleteScan(client, { scanId: SCAN_ID, photoPath: null })

    expect(remove).not.toHaveBeenCalled()
  })
})

describe('shouldTriggerEnrichment', () => {
  it('triggers for a new scan', () => {
    expect(shouldTriggerEnrichment(null, '10115', false)).toBe(true)
  })
  it('triggers when the postcode changed', () => {
    expect(shouldTriggerEnrichment(EXISTING, '80331', false)).toBe(true)
  })
  it('triggers when a new photo was added (new GPS)', () => {
    expect(shouldTriggerEnrichment(EXISTING, '10115', true)).toBe(true)
  })
  it('does not trigger for an unchanged location', () => {
    expect(shouldTriggerEnrichment(EXISTING, '10115', false)).toBe(false)
  })
})

describe('triggerEnrichment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fires POST /api/enrich and swallows failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    vi.stubGlobal('fetch', fetchMock)

    expect(() => triggerEnrichment(SCAN_ID)).not.toThrow()
    expect(fetchMock).toHaveBeenCalledWith('/api/enrich', expect.objectContaining({ method: 'POST' }))
    await Promise.resolve() // let the swallowed rejection settle
  })
})
