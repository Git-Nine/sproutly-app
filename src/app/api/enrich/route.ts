import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { parseJson, requireUser } from '@/lib/api'
import { createAdminClient } from '@/lib/supabase/admin'
import { runEnrichment } from '@/lib/enrichment/run'

/**
 * POST /api/enrich
 *
 * Trigger environmental enrichment for a saved scan (PROJ-4).
 * Auth-gated and ownership-verified. Returns 202 immediately; enrichment
 * runs in the background via Next.js after() — see src/lib/enrichment/ for
 * the orchestration (run.ts), climate assembly (climate.ts) and persistence
 * (store.ts). This handler only authenticates, validates, verifies ownership,
 * writes the initial "pending" row, and dispatches.
 *
 * The service-role admin client is used for background DB writes because the
 * request cookies may not be available after the response has been sent.
 * Ownership is always verified with the user's session BEFORE dispatching.
 */

const bodySchema = z.object({
  scan_id: z.string().uuid('scan_id must be a valid UUID'),
  retry: z.boolean().optional(),
})

export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user, supabase } = auth

  const body = await parseJson(request, bodySchema)
  if (body.response) return body.response
  const { scan_id } = body.data

  // Ownership check: RLS enforces this too, but an explicit check returns 403
  // with a clear message rather than a silent 404.
  const { data: scan, error: scanError } = await supabase
    .from('scans')
    .select('id, user_id, postcode, lat, lng')
    .eq('id', scan_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (scanError || !scan) {
    return NextResponse.json({ error: 'Scan not found or access denied.' }, { status: 403 })
  }

  // Mark as pending immediately so the UI shows the spinner.
  const admin = createAdminClient()
  const requestedAt = new Date().toISOString()

  const { error: upsertError } = await admin.from('scan_enrichment').upsert(
    {
      scan_id,
      user_id: user.id,
      status: 'pending',
      requested_at: requestedAt,
      soil_status: 'pending',
      climate_status: 'pending',
      zone_status: 'pending',
    },
    { onConflict: 'scan_id' },
  )

  if (upsertError) {
    return NextResponse.json({ error: 'Could not start enrichment.' }, { status: 500 })
  }

  // Dispatch enrichment to the background (response is sent before this runs).
  const capturedScan = {
    id: scan.id as string,
    user_id: scan.user_id as string,
    postcode: scan.postcode as string | null,
    lat: scan.lat as number | null,
    lng: scan.lng as number | null,
  }

  after(async () => {
    await runEnrichment({ scan: capturedScan, userId: user.id, requestedAt })
  })

  return NextResponse.json({ ok: true, status: 'pending' }, { status: 202 })
}
