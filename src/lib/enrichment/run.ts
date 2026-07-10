import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSoilType } from '@/lib/bgr'
import { forwardGeocodePostcode } from '@/lib/nominatim'
import { CLIMATE_PERIOD, deriveHardinessZone, fetchDwdClimate } from './climate'
import { isStillCurrent, writeResult } from './store'

/**
 * The background enrichment run (PROJ-4): resolve a coordinate for the scan,
 * pull soil (BGR) + climate (DWD) in parallel, derive the hardiness zone, and
 * upsert the result. Dispatched by POST /api/enrich via next/server after();
 * the route itself only authenticates, validates, verifies ownership, and
 * writes the initial "pending" row.
 *
 * Uses the service-role admin client because the request cookies may not be
 * available after the response has been sent — ownership is always verified
 * with the user's session BEFORE dispatching (in the route).
 */

export type EnrichableScan = {
  id: string
  user_id: string
  postcode: string | null
  lat: number | null
  lng: number | null
}

// Germany bounding box (WGS84) — all three sources are Germany-scoped.
const DE_BOUNDS = { minLng: 5.87, maxLng: 15.04, minLat: 47.27, maxLat: 55.09 }

function isInGermany(lat: number, lng: number): boolean {
  return (
    lat >= DE_BOUNDS.minLat && lat <= DE_BOUNDS.maxLat &&
    lng >= DE_BOUNDS.minLng && lng <= DE_BOUNDS.maxLng
  )
}

export async function runEnrichment({
  scan,
  userId,
  requestedAt,
}: {
  scan: EnrichableScan
  userId: string
  requestedAt: string
}) {
  const admin = createAdminClient()
  try {
    await enrich(admin, scan, userId, requestedAt)
  } catch (err) {
    console.error('[enrich] unhandled error — marking failed:', err)
    try {
      await writeResult(admin, scan.id, userId, requestedAt, { status: 'failed' })
    } catch { /* ignore — best effort */ }
  }
}

async function enrich(
  admin: ReturnType<typeof createAdminClient>,
  scan: EnrichableScan,
  userId: string,
  requestedAt: string,
) {
  // Resolve coordinate: use GPS if present, else forward-geocode the postcode.
  let lat = scan.lat
  let lng = scan.lng
  let locationBasis: 'gps' | 'postcode_centroid' = 'gps'

  if (lat == null || lng == null) {
    if (!scan.postcode) {
      await writeResult(admin, scan.id, userId, requestedAt, { status: 'failed' })
      return
    }
    const coord = await forwardGeocodePostcode(scan.postcode)
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
  // Zone only from a genuinely sampled min temp — an unsampled grid is null, so
  // a partial DWD failure can no longer fabricate the mildest zone as "confirmed"
  // and silently disable the PROJ-6 winter hard filter (PROJ-13 QA BUG-2).
  const hardinessZone = climate?.minTemp != null ? deriveHardinessZone(climate.minTemp) : null

  // "Complete" requires every climate field actually sampled — a partly failed
  // DWD run is honest 'partial', so the enrichment-retry path stays reachable.
  const climateComplete =
    climate !== null &&
    climate.rainfallMm !== null &&
    climate.minTemp !== null &&
    climate.frostDays !== null
  const allSucceeded = soilType !== null && climateComplete
  const allFailed = soilType === null && climate === null

  // Stale-result guard: discard if a newer enrichment request has started.
  if (!(await isStillCurrent(admin, scan.id, requestedAt))) return

  await writeResult(admin, scan.id, userId, requestedAt, {
    status: allSucceeded ? 'complete' : allFailed ? 'failed' : 'partial',
    soil_type: soilType ?? undefined,
    soil_status: soilType !== null ? 'success' : 'unavailable',
    // Unsampled fields stay unset (NULL in the row) — consumers null-check per
    // field, and PROJ-13's siteRainfall passes null through so the band's
    // moisture factor is skipped instead of judged against a fake 0 mm (BUG-1).
    rainfall_mm: climate?.rainfallMm ?? undefined,
    annual_min_temp: climate?.minTemp ?? undefined,
    frost_days: climate?.frostDays ?? undefined,
    climate_status: climate !== null ? 'success' : 'unavailable',
    climate_period: CLIMATE_PERIOD,
    hardiness_zone: hardinessZone ?? undefined,
    zone_status: hardinessZone !== null ? 'success' : 'unavailable',
    location_basis: locationBasis,
  })
}
