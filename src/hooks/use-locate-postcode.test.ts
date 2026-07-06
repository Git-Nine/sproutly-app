import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { useLocatePostcode } from './use-locate-postcode'

/**
 * The "Use my location" hook (PROJ-3). The `silent` option is what lets the
 * scan form attempt the device location automatically on the review step: an
 * attempt the user didn't tap must degrade quietly (no error toasts) when the
 * device denies permission or can't be reverse-geocoded.
 */

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useLocatePostcode', () => {
  it('calls onFound with the reverse-geocoded postcode on success', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ postcode: '10117' }) })) as unknown as typeof fetch
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 52.5, longitude: 13.4 } } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const onFound = vi.fn()
    const { result } = renderHook(() => useLocatePostcode(onFound))
    act(() => result.current.locate())

    await waitFor(() => expect(onFound).toHaveBeenCalledWith('10117'))
  })

  it('silent mode suppresses the error toast when permission is denied', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, error: PositionErrorCallback) =>
      error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const onFound = vi.fn()
    const { result } = renderHook(() => useLocatePostcode(onFound))
    act(() => result.current.locate({ silent: true }))

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
    expect(onFound).not.toHaveBeenCalled()
  })

  it('non-silent mode surfaces a toast when permission is denied', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, error: PositionErrorCallback) =>
      error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const { result } = renderHook(() => useLocatePostcode(vi.fn()))
    act(() => result.current.locate())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/permission denied/i)),
    )
  })
})
