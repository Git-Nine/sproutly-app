import { fetchGrid, gridValueAt } from '@/lib/dwd-grid'

/**
 * DWD climate assembly + hardiness-zone derivation for enrichment (PROJ-4).
 * Pulls three multi-annual grids (rainfall, January mean daily-minimum temp,
 * frost days) and derives the Winterhärtezone from the January temp — no
 * third API.
 */

// ─── DWD grid URLs ──────────────────────────────────────────────────────────
// File suffix = aggregate (01–12 monthly, 13–16 seasonal, 17 annual).
// Directory name uses "air_temperature_min" but the filename uses "air_temp_min"
// — verified against the live directory listing 2026-06-19.
//
// Temperature uses file 01 (JANUARY mean of daily minima), NOT file 17: the
// annual aggregate is the mean daily minimum over the whole year (~+5 °C for
// most of Germany, summer nights included), which is the wrong measure for
// winter hardiness — it derived zone 10 "confirmed" for every German site and
// silently disabled the PROJ-6 winter hard filter (2026-07-12 fix).
const DWD_BASE = 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual'

const DWD_URLS = {
  precipitation: `${DWD_BASE}/precipitation/grids_germany_multi_annual_precipitation_1991-2020_17.asc.gz`,
  janMinTemp:    `${DWD_BASE}/air_temperature_min/grids_germany_multi_annual_air_temp_min_1991-2020_01.asc.gz`,
  frostDays:     `${DWD_BASE}/frost_days/grids_germany_multi_annual_frost_days_1991-2020_17.asc.gz`,
} as const

// Verified against live file samples 2026-06-19 (precip/frost) + 2026-07-12 (Jan temp):
//   precipitation: values are actual mm (NW Germany edge = 669-692, plausible for ~700 mm/yr) → scale 1
//   janMinTemp:    values are °C×10 (Berlin = -11 → -1.1 °C, plausible Jan mean daily min) → scale 10
//   frostDays:     whole-number day counts → scale 1
const DWD_SCALE = { precipitation: 1, janMinTemp: 10, frostDays: 1 } as const

export const CLIMATE_PERIOD = '1991–2020'

/** Per-field null = that grid wasn't sampled (fetch failed, out of bounds, or
 *  NODATA). Never a fabricated value: a missing measurement stored as 0 once
 *  produced a fake "0 mm/yr" rainfall and a fake zone-10 winter (PROJ-13 QA
 *  BUG-1/BUG-2) — downstream must skip null fields, not read them as data. */
export type DwdClimate = {
  rainfallMm: number | null
  janMeanMinTemp: number | null
  frostDays: number | null
}

/** Sample the three DWD grids at a point. Null when no grid yields a value. */
export async function fetchDwdClimate(lat: number, lng: number): Promise<DwdClimate | null> {
  const [precipGrid, janMinTempGrid, frostGrid] = await Promise.all([
    fetchGrid(DWD_URLS.precipitation),
    fetchGrid(DWD_URLS.janMinTemp),
    fetchGrid(DWD_URLS.frostDays),
  ])

  const rawPrecip  = precipGrid     ? gridValueAt(precipGrid, lat, lng)     : null
  const rawJanMin  = janMinTempGrid ? gridValueAt(janMinTempGrid, lat, lng) : null
  const rawFrost   = frostGrid      ? gridValueAt(frostGrid, lat, lng)      : null

  if (rawPrecip == null && rawJanMin == null && rawFrost == null) return null

  return {
    rainfallMm:     rawPrecip != null ? Math.round(rawPrecip / DWD_SCALE.precipitation) : null,
    janMeanMinTemp: rawJanMin != null ? rawJanMin / DWD_SCALE.janMinTemp : null,
    frostDays:      rawFrost  != null ? Math.round(rawFrost / DWD_SCALE.frostDays) : null,
  }
}

/**
 * Winterhärtezone from the January mean daily-minimum temperature.
 *
 * Zones are defined on the mean ABSOLUTE annual minimum (coldest night of the
 * year, averaged over years), which DWD does not publish as a grid. The January
 * mean daily minimum is the closest gridded proxy; these thresholds were
 * calibrated 2026-07-12 against the published German Winterhärtezonen map and
 * classify all 15 reference cities correctly (zone 8: Köln +1.3 … Stuttgart
 * -0.8 · zone 7: Berlin -1.1 … Passau -3.5 · zone 6: Harz -4.9 … Oberstdorf
 * -7.3). Germany spans zones 5–9(edge cases); 10+ is unreachable by design —
 * a zone-10 result was the signature of the wrong-measure bug.
 */
export function deriveHardinessZone(janMeanMinTemp: number): string {
  if (janMeanMinTemp < -8.5) return '5'
  if (janMeanMinTemp < -4.5) return '6'
  if (janMeanMinTemp < -1.0) return '7'
  if (janMeanMinTemp < 2.5)  return '8'
  return '9'
}
