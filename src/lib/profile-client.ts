import { createClient } from '@/lib/supabase/client'
import { USERS_TABLE, type ProfileValues } from '@/lib/profile'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/**
 * Client-side persistence for the user profile (PROJ-2) — same client-write
 * pattern as the other *-client modules; RLS restricts writes to the own row.
 *
 * The avatar column has ONE owner: the uploader flow below persists
 * `users.avatar_path` immediately with each upload/remove, so the change is
 * atomic with storage and survives an abandoned form. The profile form's save
 * (updateProfile) deliberately does NOT touch avatar_path.
 */

// The app's single private bucket (PROJ-1); scans.ts exports it as STORAGE_BUCKET.
const BUCKET = 'photos'

/** Fixed per-user avatar path → at most one avatar file per user (no orphan pile-up). */
export function avatarPath(userId: string): string {
  return `${userId}/avatar`
}

/** Save the profile fields from validated form values (never avatar_path — see above). */
export async function updateProfile(
  supabase: SupabaseBrowserClient,
  userId: string,
  values: ProfileValues,
): Promise<void> {
  const { error } = await supabase
    .from(USERS_TABLE)
    .update({
      display_name: values.display_name.trim() || null,
      maintenance_preference: values.maintenance_preference,
      experience_level: values.experience_level,
    })
    .eq('id', userId)
  if (error) throw error
}

/**
 * Upload an avatar and persist its path. The upload goes first, the row update
 * immediately after, so the row never points at a missing object; the returned
 * signed URL previews the fresh image.
 */
export async function uploadAvatar(
  supabase: SupabaseBrowserClient,
  userId: string,
  file: File,
): Promise<{ signedUrl: string }> {
  const path = avatarPath(userId)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })
  if (uploadError) throw uploadError

  const { error: dbError } = await supabase
    .from(USERS_TABLE)
    .update({ avatar_path: path })
    .eq('id', userId)
  if (dbError) throw dbError

  const { data, error: urlError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (urlError) throw urlError

  return { signedUrl: data.signedUrl }
}

/**
 * Remove the avatar. The row is cleared FIRST (it's what the app reads), then
 * the file is dropped — so a partial failure never leaves the row pointing at
 * a missing object.
 */
export async function removeAvatar(
  supabase: SupabaseBrowserClient,
  userId: string,
): Promise<void> {
  const { error: dbError } = await supabase
    .from(USERS_TABLE)
    .update({ avatar_path: null })
    .eq('id', userId)
  if (dbError) throw dbError
  await supabase.storage.from(BUCKET).remove([avatarPath(userId)])
}
