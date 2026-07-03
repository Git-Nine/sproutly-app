import { fetchGrid, gridValueAt } from '@/lib/dwd-grid'

/**
 * DWD climate assembly + hardiness-zone derivation for enrichment (PROJ-4).
 * Pulls the three multi-annual grids (rainfall, annual min temp, frost days)
 * and derives the Winterhärtezone from the min temp — no third API.
 */

// ─── DWD grid URLs ──────────────────────────────────────────────────────────
// File 17 = annual aggregate (01–12 monthly, 13–16 seasonal, 17 annual).
// Directory name uses "air_temperature_min" but the filename uses "air_temp_min"
// — verified against the live directory listing 2026-06-19.
const DWD_BASE = 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual'

const DWD_URLS = {
  precipitation: `${DWD_BASE}/precipitation/grids_germany_multi_annual_precipitation_1991-2020_17.asc.gz`,
  minTemp:       `${DWD_BASE}/air_temperature_min/grids_germany_multi_annual_air_temp_min_1991-2020_17.asc.gz`,
  frostDays:     `${DWD_BASE}/frost_days/grids_germany_multi_annual_frost_days_1991-2020_17.asc.gz`,
} as const

// Verified against live file samples 2026-06-19:
//   precipitation: values are actual mm (NW Germany edge = 669-692, plausible for ~700 mm/yr) → scale 1
//   minTemp:       values are °C×10 (NW Germany edge = 73, → 7.3 °C, plausible for maritime min) → scale 10
//   frostDays:     whole-number day counts → scale 1
const DWD_SCALE = { precipitation: 1, minTemp: 10, frostDays: 1 } as const

export const CLIMATE_PERIOD = '1991–2020'

export type DwdClimate = {
  rainfallMm: number
  minTemp: number
  frostDays: number
}

/** Sample the three DWD grids at a point. Null when no grid yields a value. */
export async function fetchDwdClimate(lat: number, lng: number): Promise<DwdClimate | null> {
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

export function deriveHardinessZone(annualMinTemp: number): string {
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
