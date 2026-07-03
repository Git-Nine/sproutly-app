import { createClient } from '@/lib/supabase/client'
import { downscaleImage, type PhotoExif } from '@/lib/image'
import { STORAGE_BUCKET, scanPhotoPath, type Scan, type ScanValues } from '@/lib/scans'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/**
 * Client-side scan I/O (PROJ-3) — the photo upload, the AI-prefill and geocode
 * API calls, and the insert/update persistence, kept out of the form component
 * so the save rules (photo reuse, geo-clearing, enrichment trigger) are plain
 * testable functions. Same client-write pattern as src/lib/plans-client.ts:
 * the Supabase client comes in as a parameter, RLS enforces ownership.
 */

/**
 * Reverse-geocode coordinates to a German postcode via POST /api/geocode.
 * Returns null on any miss (non-DE location, no match, upstream/network failure)
 * so callers fall back to manual entry — never throws.
 */
export async function geocodeToPostcode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { postcode?: string | null }
    return data.postcode ?? null
  } catch {
    return null
  }
}

/**
 * Response contract of POST /api/classify-vision (the n8n scan-vision AI prefill).
 * Kept as a local shape rather than imported from the route module so client
 * code never pulls in server-only code. See docs/n8n-scan-vision-workflow.md.
 */
export type ClassifyFields = {
  surface: string
  space_type: string
  sun_exposure: string
  area_sqm: number
}

export type ClassifyResponse = {
  status: 'ok' | 'low_confidence' | 'rejected'
  fields: ClassifyFields | null
  confidence?: number
  message?: string
}

/**
 * Ask the scan-vision workflow to classify an uploaded photo.
 * Returns null on a non-OK response; throws on network failure (callers treat
 * both as "no prefill" and degrade to the manual form).
 */
export async function classifyScanPhoto({
  photoPath,
  postcode,
  scanDraftId,
}: {
  photoPath: string
  postcode?: string
  scanDraftId: string
}): Promise<ClassifyResponse | null> {
  const res = await fetch('/api/classify-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photo_path: photoPath,
      postcode: postcode || undefined,
      scan_draft_id: scanDraftId,
    }),
  })
  if (!res.ok) return null
  return (await res.json()) as ClassifyResponse
}

/** Downscale + upload a scan photo to its fixed per-scan path. Returns the path. */
export async function uploadScanPhoto(
  supabase: SupabaseBrowserClient,
  { userId, scanId, file }: { userId: string; scanId: string; file: File },
): Promise<string> {
  const optimized = await downscaleImage(file)
  const path = scanPhotoPath(userId, scanId)
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, optimized, { upsert: true, contentType: optimized.type })
  if (error) throw error
  return path
}

export type SaveScanInput = {
  scanId: string
  userId: string
  /** Existing scan when editing; null inserts a new row. */
  existing: Scan | null
  /** Validated form values (scanSchema output). */
  values: ScanValues
  photo: {
    /** Freshly picked file, if any. */
    file: File | null
    /** Path of an upload already made for this exact file (AI-prefill reuse). */
    alreadyUploadedPath: string | null
    /** True when the user removed the existing photo. */
    remove: boolean
  }
  /** EXIF of the picked file — GPS + taken_at persist with the scan. */
  exif: PhotoExif | null
}

/**
 * Persist a scan: resolve the photo (reuse the prefill upload, upload now, or
 * delete on removal), then insert or update the row. On edit, photo-derived
 * GPS/date refreshes with a new photo and clears when the photo is removed.
 * Returns the scan's URL-facing short code.
 */
export async function saveScan(
  supabase: SupabaseBrowserClient,
  { scanId, userId, existing, values, photo, exif }: SaveScanInput,
): Promise<string> {
  let photoPath = existing?.photo_path ?? null

  if (photo.file) {
    // Reuse the upload the AI-prefill step already made for this exact file;
    // otherwise upload now (e.g. classification was skipped or failed).
    photoPath =
      photo.alreadyUploadedPath ??
      (await uploadScanPhoto(supabase, { userId, scanId, file: photo.file }))
  } else if (photo.remove && existing?.photo_path) {
    // Delete the stored object; the row's photo_path (and photo-derived GPS) clears below.
    await supabase.storage.from(STORAGE_BUCKET).remove([existing.photo_path])
    photoPath = null
  }

  const fields = {
    name: values.name.trim() || null,
    postcode: values.postcode,
    sun_exposure: values.sun_exposure,
    surface: values.surface,
    space_type: values.space_type,
    area_sqm: values.area_sqm,
    photo_path: photoPath,
  }

  // The short_code (set DB-side on insert) is what the URL uses, not the uuid.
  if (existing) {
    // Refresh GPS/date with a new photo's EXIF; clear it when the photo is removed
    // (the coordinates were photo-derived); otherwise leave it untouched.
    const geo = photo.file
      ? { lat: exif?.lat ?? null, lng: exif?.lng ?? null, taken_at: exif?.takenAt ?? null }
      : photo.remove
        ? { lat: null, lng: null, taken_at: null }
        : {}
    const { error } = await supabase
      .from('scans')
      .update({ ...fields, ...geo })
      .eq('id', scanId)
    if (error) throw error
    return existing.short_code
  }

  const { data: inserted, error } = await supabase
    .from('scans')
    .insert({
      id: scanId,
      user_id: userId,
      ...fields,
      lat: exif?.lat ?? null,
      lng: exif?.lng ?? null,
      taken_at: exif?.takenAt ?? null,
    })
    .select('short_code')
    .single<{ short_code: string }>()
  if (error) throw error
  return inserted.short_code
}

/** Enrichment re-runs for a new scan, a changed postcode, or a new photo (new GPS). */
export function shouldTriggerEnrichment(
  existing: Scan | null,
  postcode: string,
  hasNewPhoto: boolean,
): boolean {
  return !existing || postcode !== (existing.postcode ?? '') || hasNewPhoto
}

/**
 * Delete a scan. The ROW goes first — it's what the app reads and what RLS
 * protects; the stored photo is then removed best-effort, so a storage hiccup
 * leaves at worst an invisible orphaned object. (The previous order destroyed
 * the photo even when the row delete then failed.)
 */
export async function deleteScan(
  supabase: SupabaseBrowserClient,
  { scanId, photoPath }: { scanId: string; photoPath: string | null },
): Promise<void> {
  const { error } = await supabase.from('scans').delete().eq('id', scanId)
  if (error) throw error

  if (photoPath) {
    try {
      const { error: rmError } = await supabase.storage.from(STORAGE_BUCKET).remove([photoPath])
      if (rmError) console.error('[scan delete] photo cleanup failed:', rmError)
    } catch (err) {
      console.error('[scan delete] photo cleanup failed:', err)
    }
  }
}

/** Fire-and-forget POST /api/enrich — enrichment failure never blocks the save flow. */
export function triggerEnrichment(scanId: string): void {
  fetch('/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan_id: scanId }),
  }).catch(() => {
    // Fire-and-forget.
  })
}
