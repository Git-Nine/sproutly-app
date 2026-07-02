import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScanForm } from './scan-form'

/**
 * PROJ-3 AI swap-in point — the scan-vision prefill wiring.
 *
 * These tests exercise the observable behaviour of picking a photo: the form
 * uploads it and calls POST /api/classify-vision, then on a confident ("ok")
 * read it prefills the conditions and shows the "we filled these in" hint. On a
 * fallback read it leaves the fields blank so the user fills them in manually.
 *
 * The Supabase client, next/navigation, sonner and image helpers are mocked so
 * the component renders in jsdom; the n8n call is exercised through global fetch.
 */

const USER_ID = 'user-abc'

// downscaleImage/readPhotoExif touch canvas + EXIF libs that don't run in jsdom.
vi.mock('@/lib/image', () => ({
  downscaleImage: async (f: File) => f,
  readPhotoExif: async () => ({}), // no GPS → geocode is skipped, only classify runs
  isHeic: () => false,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
}))

function pickPhoto() {
  // Both file inputs are hidden but present; either drives PhotoPicker.handleFile.
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], 'garden.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('ScanForm — n8n scan-vision prefill', () => {
  beforeEach(() => {
    // jsdom lacks object-URL support that PhotoPicker uses for the preview.
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('classifies a picked photo and prefills the conditions on a confident read', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes('/api/classify-vision')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            fields: {
              surface: 'gravel',
              space_type: 'front_garden',
              sun_exposure: 'partial',
              area_sqm: 8,
            },
            confidence: 0.82,
          }),
        }
      }
      return { ok: false, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<ScanForm userId={USER_ID} scan={null} photoUrl={null} />)
    pickPhoto()

    // It calls the classify endpoint...
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/classify-vision', expect.objectContaining({ method: 'POST' })),
    )

    // ...with a photo_path scoped to THIS user's namespace (the route requires it).
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/classify-vision'))!
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.photo_path.startsWith(`${USER_ID}/`)).toBe(true)
    expect(body.scan_draft_id).toBeTruthy()

    // The returned area lands in the editable field, and the prefill hint shows.
    const area = screen.getByLabelText(/approximate area/i) as HTMLInputElement
    await waitFor(() => expect(area.value).toBe('8'))
    expect(screen.getByText(/we filled in what we could see/i)).toBeInTheDocument()
  })

  it('leaves the fields blank and shows no prefill hint on a fallback read', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes('/api/classify-vision')) {
        return {
          ok: true,
          json: async () => ({
            status: 'low_confidence',
            fields: null,
            message: "We couldn't read the photo automatically.",
          }),
        }
      }
      return { ok: false, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<ScanForm userId={USER_ID} scan={null} photoUrl={null} />)
    pickPhoto()

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/classify-vision', expect.objectContaining({ method: 'POST' })),
    )

    const area = screen.getByLabelText(/approximate area/i) as HTMLInputElement
    // Give any (unexpected) prefill a chance to land, then assert it did NOT.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(area.value).toBe('')
    expect(screen.queryByText(/we filled in what we could see/i)).not.toBeInTheDocument()
  })
})
