import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSoilType } from '@/lib/bgr'
import { fetchGrid, gridValueAt } from '@/lib/dwd-grid'

/**
 * POST /api/enrich
 *
 * Trigger environmental enrichment for a saved scan (PROJ-4).
 * Auth-gated and ownership-verified. Returns 202 immediately; enrichment
 * runs in the background via Next.js after().
 *
 * Sources:
 *  - BGR BÜK200 ArcGIS REST Identify  → soil type
 *  - DWD CDC multi-annual grids        → annual rainfall, annual min temp, frost days
 *  - Derived from DWD min temp         → hardiness zone (no third API)
 *
 * The service-role admin client is used for background DB writes because the
 * request cookies may not be available after the response has been sent.
 * Ownership is always verified with the user's session BEFORE dispatching.
 */

const bodySchema = z.object({
  scan_id: z.string().uuid('scan_id must be a valid UUID'),
  retry: z.boolean().optional(),
})

// Germany bounding box (WGS84) — all three sources are Germany-scoped.
const DE_BOUNDS = { minLng: 5.87, maxLng: 15.04, minLat: 47.27, maxLat: 55.09 }

// ─── DWD grid URLs ──────────────────────────────────────────────────────────
// Period code 9120 = 1991–2020 (two-digit start + two-digit end, DWD convention).
// File 17 = annual aggregate (01–12 monthly, 13–16 seasonal, 17 annual).
// VERIFY these URLs against the actual directory listing before first deploy:
//   https://opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual/
const DWD_BASE = 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual'
const DWD_PERIOD = '9120'

const DWD_URLS = {
  precipitation: `${DWD_BASE}/precipitation/grids_germany_multi_annual_precipitation_${DWD_PERIOD}_17.asc.gz`,
  minTemp:       `${DWD_BASE}/air_temperature_min/grids_germany_multi_annual_air_temperature_min_${DWD_PERIOD}_17.asc.gz`,
  frostDays:     `${DWD_BASE}/frost_days/grids_germany_multi_annual_frost_days_${DWD_PERIOD}_17.asc.gz`,
} as const

// DWD grids store values in tenths of the unit (°C×10, mm×10); frost days are whole.
// VERIFY against a real file's header/README before production deploy.
const DWD_SCALE = { precipitation: 10, minTemp: 10, frostDays: 1 } as const

const CLIMATE_PERIOD = '1991–2020'
const NOMINATIM_TIMEOUT_MS = 5_000
const USER_AGENT = 'Sproutly/1.0 (+https://sproutly.app)'

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  let parsed: ReturnType<typeof bodySchema.safeParse>
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    )
  }

  const { scan_id, retry = false } = parsed.data

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

// ─── Enrichment orchestrator (exported for testing) ──────────────────────────

export async function runEnrichment({
  scan,
  userId,
  requestedAt,
}: {
  scan: { id: string; user_id: string; postcode: string | null; lat: number | null; lng: number | null }
  userId: string
  requestedAt: string
}) {
  const admin = createAdminClient()

  // Resolve coordinate: use GPS if present, else forward-geocode the postcode.
  let lat = scan.lat
  let lng = scan.lng
  let locationBasis: 'gps' | 'postcode_centroid' = 'gps'

  if (lat == null || lng == null) {
    if (!scan.postcode) {
      await writeResult(admin, scan.id, userId, requestedAt, { status: 'failed' })
      return
    }
    const coord = await geocodePostcode(scan.postcode)
    if (!coord) {
      await writeResult(admin, scan.id, userId, requestedAt, { status: 'failed' })
      return
    }
    lat = coord.lat
    lng = coord.lng
    locationBasis = 'postcode_centroid'
  }

  // All three sources are Germany-scoped; nothing to enrich for non-DE locations.
  if (!isInGermany(lat, lng)) {
    await writeResult(admin, scan.id, userId, requestedAt, {
      status: 'complete',
      soil_status: 'unavailable',
      climate_status: 'unavailable',
      zone_status: 'unavailable',
      location_basis: locationBasis,
    })
    return
  }

  // Run BGR and DWD in parallel — independent sources, independent failures.
  const [soilResult, climateResult] = await Promise.allSettled([
    fetchSoilType(lat, lng),
    fetchDwdClimate(lat, lng),
  ])

  const soilType = soilResult.status === 'fulfilled' ? soilResult.value : null
  const climate = climateResult.status === 'fulfilled' ? climateResult.value : null
  const hardinessZone = climate?.minTemp != null ? deriveHardinessZone(climate.minTemp) : null

  const allSucceeded = soilType !== null && climate !== null
  const allFailed = soilType === null && climate === null

  // Stale-result guard: discard if a newer enrichment request has started.
  if (!(await isStillCurrent(admin, scan.id, requestedAt))) return

  await writeResult(admin, scan.id, userId, requestedAt, {
    status: allSucceeded ? 'complete' : allFailed ? 'failed' : 'partial',
    soil_type: soilType ?? undefined,
    soil_status: soilType !== null ? 'success' : 'unavailable',
    rainfall_mm: climate?.rainfallMm,
    annual_min_temp: climate?.minTemp,
    frost_days: climate?.frostDays,
    climate_status: climate !== null ? 'success' : 'unavailable',
    climate_period: CLIMATE_PERIOD,
    hardiness_zone: hardinessZone ?? undefined,
    zone_status: hardinessZone !== null ? 'success' : 'unavailable',
    location_basis: locationBasis,
  })
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function fetchDwdClimate(lat: number, lng: number): Promise<{
  rainfallMm: number
  minTemp: number
  frostDays: number
} | null> {
  const [precipGrid, minTempGrid, frostGrid] = await Promise.all([
    fetchGrid(DWD_URLS.precipitation),
    fetchGrid(DWD_URLS.minTemp),
    fetchGrid(DWD_URLS.frostDays),
  ])

  const rawPrecip   = precipGrid   ? gridValueAt(precipGrid, lat, lng)   : null
  const rawMinTemp  = minTempGrid  ? gridValueAt(minTempGrid, lat, lng)  : null
  const rawFrost    = frostGrid    ? gridValueAt(frostGrid, lat, lng)    : null

  if (rawPrecip == null && rawMinTemp == null && rawFrost == null) return null

  return {
    rainfallMm: rawPrecip  != null ? Math.round(rawPrecip / DWD_SCALE.precipitation) : 0,
    minTemp:    rawMinTemp != null ? rawMinTemp / DWD_SCALE.minTemp : 0,
    frostDays:  rawFrost   != null ? Math.round(rawFrost / DWD_SCALE.frostDays) : 0,
  }
}

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&country=DE&postalcode=${encodeURIComponent(postcode)}&limit=1`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (!Array.isArray(data) || !data[0]) return null
    const lat = parseFloat(String(data[0].lat))
    const lng = parseFloat(String(data[0].lon))
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function isInGermany(lat: number, lng: number): boolean {
  return (
    lat >= DE_BOUNDS.minLat && lat <= DE_BOUNDS.maxLat &&
    lng >= DE_BOUNDS.minLng && lng <= DE_BOUNDS.maxLng
  )
}

function deriveHardinessZone(annualMinTemp: number): string {
  // DWD Winterhärtezonen — based on mean absolute annual minimum temperature.
  // Germany spans approximately zones 5–9; most populated areas fall in 6–8.
  // Thresholds are approximate — verify against DWD climate atlas documentation.
  if (annualMinTemp < -28) return '5'
  if (annualMinTemp < -23) return '6'
  if (annualMinTemp < -17) return '7'
  if (annualMinTemp < -12) return '8'
  if (annualMinTemp < -7)  return '9'
  return '10'
}

async function isStillCurrent(
  admin: ReturnType<typeof createAdminClient>,
  scanId: string,
  requestedAt: string,
): Promise<boolean> {
  const { data } = await admin
    .from('scan_enrichment')
    .select('requested_at')
    .eq('scan_id', scanId)
    .maybeSingle()
  return data?.requested_at === requestedAt
}

type EnrichmentFields = {
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

async function writeResult(
  admin: ReturnType<typeof createAdminClient>,
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
