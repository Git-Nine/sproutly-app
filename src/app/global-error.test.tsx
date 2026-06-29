import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GlobalError from './global-error'

/**
 * PROJ-2 (login error hardening) — last-resort boundary for errors thrown in
 * the root layout. It renders its own document chrome (no app CSS), shows a
 * message, and the "Back to start" button does a hard navigation to "/".
 * We assert that navigation via a stubbed window.location.assign.
 */

describe('global error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a recovery message', () => {
    render(<GlobalError error={new Error('boom')} />)
    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument()
  })

  it('navigates to "/" when "Back to start" is clicked', () => {
    const assign = vi.fn()
    const original = window.location
    // jsdom's location.assign is non-configurable; replace the object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    })

    render(<GlobalError error={new Error('boom')} />)
    fireEvent.click(screen.getByRole('button', { name: /back to start/i }))
    expect(assign).toHaveBeenCalledWith('/')

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: original,
    })
  })

  it('logs the error for debugging', () => {
    const err = new Error('boom')
    render(<GlobalError error={err} />)
    expect(console.error).toHaveBeenCalledWith(err)
  })
})
