import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
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

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

// Keep the real classify/upload/geocode helpers (the other tests exercise them);
// stub only the persistence + enrichment side-effects so save resolves offline.
vi.mock('@/lib/scans-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scans-client')>()
  return {
    ...actual,
    saveScan: vi.fn(async () => 'GhUrEi67'),
    shouldTriggerEnrichment: vi.fn(() => false),
    triggerEnrichment: vi.fn(),
  }
})

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

/** Wizard step 1 → step 3: skip the photo to reach the editable review screen. */
function skipPhoto() {
  fireEvent.click(screen.getByRole('button', { name: /no photo handy/i }))
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

    // After "Reading your space…" the flow lands on the review step: the returned
    // area lands in the editable field, and the prefill hint shows.
    const area = (await screen.findByLabelText(/approximate area/i)) as HTMLInputElement
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

    // The fallback read still advances to the review step, but with blank fields.
    const area = (await screen.findByLabelText(/approximate area/i)) as HTMLInputElement
    expect(area.value).toBe('')
    expect(screen.queryByText(/we filled in what we could see/i)).not.toBeInTheDocument()
  })
})

describe('ScanForm — save navigation', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    push.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a new scan straight to the plan screen (skipping the scan detail page)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/classify-vision')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            fields: { surface: 'gravel', space_type: 'front_garden', sun_exposure: 'partial', area_sqm: 8 },
            confidence: 0.82,
          }),
        }
      }
      return { ok: false, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<ScanForm userId={USER_ID} scan={null} photoUrl={null} />)
    pickPhoto()

    // The confident read prefills sun/surface/space/area; add the one remaining
    // required field (postcode) so the schema validates, then submit.
    const area = (await screen.findByLabelText(/approximate area/i)) as HTMLInputElement
    await waitFor(() => expect(area.value).toBe('8'))
    fireEvent.change(screen.getByLabelText(/postcode/i), { target: { value: '10115' } })

    fireEvent.click(screen.getByRole('button', { name: /show me my plan/i }))

    // Lands on the plan (which auto-builds), NOT the scan detail page.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/scans/GhUrEi67/plan'))
    expect(push).not.toHaveBeenCalledWith('/scans/GhUrEi67')
  })
})

describe('ScanForm — "Use my location" postcode fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reverse-geocodes the device location into the postcode field', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes('/api/geocode')) {
        return { ok: true, json: async () => ({ postcode: '10115' }) }
      }
      return { ok: false, json: async () => ({}) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    // Device grants location: fire the success callback with Berlin-ish coords.
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 52.53, longitude: 13.38 } } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    render(<ScanForm userId={USER_ID} scan={null} photoUrl={null} />)
    skipPhoto()
    fireEvent.click(screen.getByRole('button', { name: /use my location/i }))

    // It reverse-geocodes the device coordinates...
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/geocode', expect.objectContaining({ method: 'POST' })),
    )
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/geocode'))!
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ lat: 52.53, lng: 13.38 })

    // ...and the returned postcode lands in the editable field with the source hint.
    const postcode = screen.getByLabelText(/postcode/i) as HTMLInputElement
    await waitFor(() => expect(postcode.value).toBe('10115'))
    expect(screen.getByText(/filled from your current location/i)).toBeInTheDocument()
  })

  it('shows an error toast and leaves the postcode blank when permission is denied', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    global.fetch = fetchMock as unknown as typeof fetch

    // Device denies location: fire the error callback with PERMISSION_DENIED.
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
      error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    render(<ScanForm userId={USER_ID} scan={null} photoUrl={null} />)
    skipPhoto()
    fireEvent.click(screen.getByRole('button', { name: /use my location/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/permission denied/i)))
    expect(fetchMock).not.toHaveBeenCalled()
    const postcode = screen.getByLabelText(/postcode/i) as HTMLInputElement
    expect(postcode.value).toBe('')
  })
})
