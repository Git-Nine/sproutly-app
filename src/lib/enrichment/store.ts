import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Persistence for enrichment results (PROJ-4) — the scan_enrichment upsert and
 * the stale-result guard, shared by the route's initial "pending" write and the
 * background run's final write.
 */

type AdminClient = ReturnType<typeof createAdminClient>

export type EnrichmentFields = {
  status: 'pending' | 'complete' | 'partial' | 'failed'
  soil_type?: string
  soil_status?: 'pending' | 'success' | 'unavailable'
  rainfall_mm?: number
  annual_min_temp?: number
  frost_days?: number
  climate_status?: 'pending' | 'success' | 'unavailable'
  climate_period?: string
  hardiness_zone?: string
  zone_status?: 'pending' | 'success' | 'unavailable'
  location_basis?: 'gps' | 'postcode_centroid'
}

export async function writeResult(
  admin: AdminClient,
  scanId: string,
  userId: string,
  requestedAt: string,
  fields: EnrichmentFields,
) {
  await admin.from('scan_enrichment').upsert(
    { scan_id: scanId, user_id: userId, requested_at: requestedAt, ...fields },
    { onConflict: 'scan_id' },
  )
}

/** Stale-result guard: false when a newer enrichment request has started. */
export async function isStillCurrent(
  admin: AdminClient,
  scanId: string,
  requestedAt: string,
): Promise<boolean> {
  const { data } = await admin
    .from('scan_enrichment')
    .select('requested_at')
    .eq('scan_id', scanId)
    .maybeSingle()
  if (!data?.requested_at) return false
  // Compare by numeric timestamp — PostgREST returns "+00:00" suffix while
  // new Date().toISOString() produces "Z". Same instant, different strings.
  return new Date(data.requested_at).getTime() === new Date(requestedAt).getTime()
}
