import { describe, it, expect } from 'vitest'
import { safeReturnTo } from './safe-return-to'

describe('safeReturnTo', () => {
  it('allows root-relative internal paths', () => {
    expect(safeReturnTo('/')).toBe('/')
    expect(safeReturnTo('/profile')).toBe('/profile')
    expect(safeReturnTo('/scans/123')).toBe('/scans/123')
    expect(safeReturnTo('/scans?tab=new&x=1')).toBe('/scans?tab=new&x=1')
  })

  it('rejects the backslash open-redirect bypass (BUG-1)', () => {
    // The old guard accepted these; browsers normalize "\" to "/" → external host.
    expect(safeReturnTo('/\\evil.com')).toBe('/')
    expect(safeReturnTo('/\\/evil.com')).toBe('/')
    expect(safeReturnTo('/path\\to\\evil')).toBe('/')
  })

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeReturnTo('//evil.com')).toBe('/')
    expect(safeReturnTo('https://evil.com')).toBe('/')
    expect(safeReturnTo('http://evil.com')).toBe('/')
  })

  it('rejects non-rooted values and control characters', () => {
    expect(safeReturnTo('evil.com')).toBe('/')
    expect(safeReturnTo('javascript:alert(1)')).toBe('/')
    expect(safeReturnTo('/foo\nbar')).toBe('/')
    expect(safeReturnTo('/foo\tbar')).toBe('/')
  })

  it('falls back to / for empty, null, or undefined', () => {
    expect(safeReturnTo('')).toBe('/')
    expect(safeReturnTo(null)).toBe('/')
    expect(safeReturnTo(undefined)).toBe('/')
  })
})
