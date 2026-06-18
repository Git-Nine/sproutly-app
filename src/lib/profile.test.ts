import { describe, it, expect } from 'vitest'
import {
  initialsFor,
  validateAvatarFile,
  AVATAR_MAX_BYTES,
  profileSchema,
  otpSchema,
  emailSchema,
} from './profile'

/** Build a fake File with a given type/size without allocating real bytes. */
function fakeFile(type: string, size: number): File {
  const f = new File(['x'], 'avatar', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('initialsFor', () => {
  it('uses two-word display names → first letter of each, uppercased', () => {
    expect(initialsFor('Maya Müller', 'x@y.de')).toBe('MM')
  })

  it('falls back to the email prefix when there is no display name', () => {
    expect(initialsFor(null, 'thomas@example.com')).toBe('TH')
  })

  it('splits email-prefix separators (dot/underscore/dash) into two initials', () => {
    expect(initialsFor(null, 'jane.prange@example.com')).toBe('JP')
  })

  it('uses the first two letters for a single-word source', () => {
    expect(initialsFor('Sprout', null)).toBe('SP')
  })

  it('returns ? when there is neither a name nor an email', () => {
    expect(initialsFor(null, null)).toBe('?')
  })

  it('ignores a blank/whitespace display name and uses the email', () => {
    expect(initialsFor('   ', 'kai@example.com')).toBe('KA')
  })
})

describe('validateAvatarFile', () => {
  it('accepts a JPEG under the size limit', () => {
    expect(validateAvatarFile(fakeFile('image/jpeg', 1024))).toBeNull()
  })

  it('accepts PNG and WebP', () => {
    expect(validateAvatarFile(fakeFile('image/png', 1024))).toBeNull()
    expect(validateAvatarFile(fakeFile('image/webp', 1024))).toBeNull()
  })

  it('rejects a disallowed type (e.g. SVG, GIF, PDF)', () => {
    expect(validateAvatarFile(fakeFile('image/svg+xml', 10))).toMatch(/JPEG, PNG, or WebP/)
    expect(validateAvatarFile(fakeFile('image/gif', 10))).toMatch(/JPEG, PNG, or WebP/)
    expect(validateAvatarFile(fakeFile('application/pdf', 10))).toMatch(/JPEG, PNG, or WebP/)
  })

  it('rejects a file over 5 MB', () => {
    expect(validateAvatarFile(fakeFile('image/png', AVATAR_MAX_BYTES + 1))).toMatch(/5 MB or smaller/)
  })

  it('accepts a file exactly at the 5 MB boundary', () => {
    expect(validateAvatarFile(fakeFile('image/png', AVATAR_MAX_BYTES))).toBeNull()
  })
})

describe('profileSchema', () => {
  it('accepts a display name at the 50-char boundary', () => {
    expect(profileSchema.safeParse({
      display_name: 'a'.repeat(50),
      maintenance_preference: null,
      experience_level: null,
    }).success).toBe(true)
  })

  it('rejects a display name over 50 chars', () => {
    const r = profileSchema.safeParse({
      display_name: 'a'.repeat(51),
      maintenance_preference: null,
      experience_level: null,
    })
    expect(r.success).toBe(false)
  })

  it('rejects an invalid enum value', () => {
    expect(profileSchema.safeParse({
      display_name: '',
      maintenance_preference: 'extreme',
      experience_level: null,
    }).success).toBe(false)
  })
})

describe('emailSchema / otpSchema', () => {
  it('rejects empty and malformed emails, accepts a valid one', () => {
    expect(emailSchema.safeParse({ email: '' }).success).toBe(false)
    expect(emailSchema.safeParse({ email: 'notanemail' }).success).toBe(false)
    expect(emailSchema.safeParse({ email: 'maya@example.de' }).success).toBe(true)
  })

  it('accepts only a 6-digit numeric code', () => {
    expect(otpSchema.safeParse({ token: '123456' }).success).toBe(true)
    expect(otpSchema.safeParse({ token: '12345' }).success).toBe(false)
    expect(otpSchema.safeParse({ token: '1234567' }).success).toBe(false)
    expect(otpSchema.safeParse({ token: 'abcdef' }).success).toBe(false)
  })
})
