import { describe, it, expect } from 'vitest'
import { authErrorMessage } from './auth-errors'

describe('authErrorMessage', () => {
  it('returns the rate-limit message for HTTP 429 (ignoring the raw message)', () => {
    expect(authErrorMessage({ status: 429, message: 'rate limited' }, 'fallback')).toBe(
      'Too many requests — please wait a minute before trying again.',
    )
  })

  it("surfaces the provider's message when present and not rate-limited", () => {
    expect(authErrorMessage({ status: 400, message: 'Invalid token' }, 'fallback')).toBe('Invalid token')
  })

  it('uses the fallback when there is no error (e.g. session missing without an error object)', () => {
    expect(authErrorMessage(null, 'That code is invalid or expired. Request a new one.')).toBe(
      'That code is invalid or expired. Request a new one.',
    )
  })

  it('uses the fallback when the error has no message', () => {
    expect(authErrorMessage({ status: 500 }, 'Could not send the link. Please try again.')).toBe(
      'Could not send the link. Please try again.',
    )
  })
})
