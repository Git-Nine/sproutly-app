import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { STORAGE_BUCKET } from '@/lib/scans'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Permanently delete the currently-authenticated user's account.
 *
 * Deleting an auth user requires the service-role key, so this is the single place
 * that key is used. Removing the auth.users row drops the public.users profile (and
 * its scans / plans) via the FK ON DELETE CASCADE.
 *
 * GDPR photo erasure: we remove the user's files from the private `photos` bucket
 * via the Storage API *before* deleting the user. (This used to be done by the
 * PROJ-1 `on_auth_user_deleted` trigger, but Supabase now blocks direct deletes on
 * storage.objects — `storage.protect_delete()` — which broke every user deletion.
 * That trigger is dropped in 20260622110000_proj2_fix_user_deletion_drop_storage_trigger.sql.)
 *
 * The client signs out and redirects after a successful response.
 */

/** Recursively collect every object path under a prefix in the bucket. */
async function listUserObjectPaths(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return []
  const paths: string[] = []
  for (const entry of data) {
    const path = `${prefix}/${entry.name}`
    // Folders come back with a null id; recurse into them, otherwise it's a file.
    if (entry.id === null) {
      paths.push(...(await listUserObjectPaths(admin, bucket, path)))
    } else {
      paths.push(path)
    }
  }
  return paths
}

export async function POST() {
  // Identify the caller from their session cookie — never trust a client-supplied id.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const admin = createAdminClient()

  // GDPR: clear the user's photos via the Storage API. Best-effort — a storage hiccup
  // must never block account deletion (the user could otherwise never erase their account).
  try {
    const paths = await listUserObjectPaths(admin, STORAGE_BUCKET, user.id)
    if (paths.length > 0) {
      await admin.storage.from(STORAGE_BUCKET).remove(paths)
    }
  } catch {
    // Swallow — proceed to delete the account regardless; orphaned files can be swept later.
  }

  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    return NextResponse.json(
      { error: 'Could not delete your account. Please try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
