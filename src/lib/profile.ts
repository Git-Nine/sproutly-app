import { z } from 'zod'

/** Profile option sets — mirror the check constraints on public.users (PROJ-1). */
export const MAINTENANCE_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const

export const EXPERIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
] as const

/** Sentinel used by the Select "no preference" item (Radix forbids empty string values). */
export const UNSET = '__unset__'

export const DISPLAY_NAME_MAX = 50

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const emailSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
})
export type EmailValues = z.infer<typeof emailSchema>

export const otpSchema = z.object({
  token: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
})
export type OtpValues = z.infer<typeof otpSchema>

export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(DISPLAY_NAME_MAX, `Keep it under ${DISPLAY_NAME_MAX} characters`),
  maintenance_preference: z.enum(['low', 'medium', 'high']).nullable(),
  experience_level: z.enum(['beginner', 'intermediate', 'expert']).nullable(),
})
export type ProfileValues = z.infer<typeof profileSchema>

/** The shape of a row in public.users that the UI reads. */
export type UserProfile = {
  id: string
  email: string | null
  role: 'user' | 'admin'
  display_name: string | null
  avatar_path: string | null
  maintenance_preference: 'low' | 'medium' | 'high' | null
  experience_level: 'beginner' | 'intermediate' | 'expert' | null
}

/** Initials shown when there is no avatar / display name. */
export function initialsFor(displayName: string | null, email: string | null): string {
  const source = displayName?.trim() || email?.split('@')[0] || '?'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

/** Validate a selected avatar file against the type/size rules. Returns an error message or null. */
export function validateAvatarFile(file: File): string | null {
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
    return 'Please choose a JPEG, PNG, or WebP image.'
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'Image must be 5 MB or smaller.'
  }
  return null
}
