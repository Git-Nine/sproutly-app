import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from './error'

/**
 * PROJ-2 (login error hardening) — the route-level error boundary must offer
 * recovery instead of a blank crash: a message, a working "Try again" that
 * calls reset(), and an escape link back to the user's spaces. We silence the
 * console.error the boundary emits on mount so the test output stays clean.
 */

describe('app route error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup() {
    const reset = vi.fn()
    render(<ErrorBoundary error={new Error('boom')} reset={reset} />)
    return { reset }
  }

  it('shows a recovery message', () => {
    setup()
    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument()
  })

  it('calls reset() when "Try again" is clicked', () => {
    const { reset } = setup()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('offers an escape link back to my spaces', () => {
    setup()
    expect(
      screen.getByRole('link', { name: /back to my spaces/i }),
    ).toHaveAttribute('href', '/scans')
  })

  it('logs the error for debugging', () => {
    const err = new Error('boom')
    const reset = vi.fn()
    render(<ErrorBoundary error={err} reset={reset} />)
    expect(console.error).toHaveBeenCalledWith(err)
  })
})
