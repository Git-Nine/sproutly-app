import { gunzipSync } from 'node:zlib'

/**
 * DWD CDC multi-annual ASCII grid (.asc.gz) download, parse, and point lookup.
 * Used by PROJ-4 environmental enrichment for precipitation, air temperature
 * minimum, and frost-day count lookups.
 *
 * DWD grids use EPSG:31467 (Gauß-Krüger Zone 3) — projected coordinates in
 * metres. `xllcorner` is ~3.28 million (easting) and `yllcorner` is ~5.24
 * million (northing). `gridValueAt` detects this (xllcorner > 1 000 000) and
 * reprojects WGS84 lat/lng to GK3 before the cell lookup.
 *
 * DWD temperature and precipitation grids typically store values in tenths of the
 * unit (°C × 10, mm × 10). The caller is responsible for applying the right
 * scale factor. Frost-day counts are whole numbers (scale = 1).
 */

export type AscGrid = {
  ncols: number
  nrows: number
  xllcorner: number  // left-edge longitude (or x if projected)
  yllcorner: number  // bottom-edge latitude (or y if projected)
  cellsize: number
  nodata: number
  values: Float32Array
}

const FETCH_TIMEOUT_MS = 15_000

// Module-level cache keyed by URL; persists across Fluid Compute warm requests.
const gridCache = new Map<string, AscGrid>()

/** Download, decompress, and parse an ASCII grid from a DWD CDC URL. Cached. */
export async function fetchGrid(url: string): Promise<AscGrid | null> {
  const cached = gridCache.get(url)
  if (cached) return cached

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null

    const raw = await res.arrayBuffer()
    const text = gunzipSync(Buffer.from(raw)).toString('latin1')
    const grid = parseAscGrid(text)
    if (grid) gridCache.set(url, grid)
    return grid
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Return the grid value at the given WGS84 lat/lng. Returns null on out-of-bounds or NODATA. */
export function gridValueAt(grid: AscGrid, lat: number, lng: number): number | null {
  // DWD grids are in Gauß-Krüger Zone 3 (EPSG:31467). Detect by xllcorner >> 180.
  let px = lng  // easting  (ASC x-axis, maps to xllcorner)
  let py = lat  // northing (ASC y-axis, maps to yllcorner)
  if (grid.xllcorner > 1_000_000) {
    const gk = wgs84ToGK3(lat, lng)
    px = gk.easting
    py = gk.northing
  }

  const col = Math.floor((px - grid.xllcorner) / grid.cellsize)
  // ASC row 0 = top of the grid (north), so rows increase southward.
  const row = Math.floor((grid.yllcorner + grid.nrows * grid.cellsize - py) / grid.cellsize)

  if (col < 0 || col >= grid.ncols || row < 0 || row >= grid.nrows) return null

  const val = grid.values[row * grid.ncols + col]
  if (val === undefined || val === grid.nodata) return null
  return val
}

/**
 * Converts WGS84 lat/lng (degrees) to Gauß-Krüger Zone 3 (EPSG:31467).
 * Uses the Bessel 1841 ellipsoid + Transverse Mercator. Accuracy: ~50–100 m —
 * well within the 1 km DWD grid cell, so no datum shift (DHDN→WGS84) needed.
 */
function wgs84ToGK3(latDeg: number, lngDeg: number): { northing: number; easting: number } {
  const a = 6377397.155  // Bessel 1841 semi-major axis (m)
  const e2 = 0.006674372 // first eccentricity squared

  const φ = (latDeg * Math.PI) / 180
  const λ = (lngDeg * Math.PI) / 180
  const λ0 = (9 * Math.PI) / 180  // Zone 3 central meridian = 9°E

  const sinφ = Math.sin(φ)
  const cosφ = Math.cos(φ)
  const tanφ = Math.tan(φ)
  const dλ = λ - λ0

  const N = a / Math.sqrt(1 - e2 * sinφ * sinφ)
  const t = tanφ
  const η2 = (e2 / (1 - e2)) * cosφ * cosφ

  const e4 = e2 * e2
  const e6 = e4 * e2

  // Meridional arc from equator to φ (Bessel series coefficients)
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * φ
      - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * φ)
      + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * φ)
      - ((35 * e6) / 3072) * Math.sin(6 * φ))

  const northing =
    M +
    (N / 2) * sinφ * cosφ * dλ * dλ +
    (N / 24) * sinφ * (cosφ * cosφ * cosφ) * (5 - t * t + 9 * η2 + 4 * η2 * η2) * dλ * dλ * dλ * dλ

  const easting =
    3_500_000 +
    N * cosφ * dλ +
    (N / 6) * (cosφ * cosφ * cosφ) * (1 - t * t + η2) * dλ * dλ * dλ +
    (N / 120) * (cosφ * cosφ * cosφ * cosφ * cosφ) * (5 - 18 * t * t + t * t * t * t + 14 * η2 - 58 * t * t * η2) * dλ * dλ * dλ * dλ * dλ

  return { northing, easting }
}

function parseAscGrid(text: string): AscGrid | null {
  const lines = text.split('\n')
  const header: Record<string, number> = {}
  let dataStart = 0

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i].trim()
    if (!line) { dataStart = i + 1; continue }

    const parts = line.split(/\s+/)
    if (parts.length === 2 && isNaN(Number(parts[0]))) {
      header[parts[0].toLowerCase()] = Number(parts[1])
      dataStart = i + 1
    } else {
      dataStart = i
      break
    }
  }

  const ncols = header['ncols']
  const nrows = header['nrows']
  const xllcorner = header['xllcorner'] ?? header['xllcenter']
  const yllcorner = header['yllcorner'] ?? header['yllcenter']
  const cellsize = header['cellsize']
  const nodata = header['nodata_value'] ?? -999

  if (!ncols || !nrows || xllcorner == null || yllcorner == null || !cellsize) return null

  const values = new Float32Array(ncols * nrows)
  let idx = 0
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    for (const token of line.split(/\s+/)) {
      if (idx >= values.length) break
      values[idx++] = parseFloat(token)
    }
  }

  return { ncols, nrows, xllcorner, yllcorner, cellsize, nodata, values }
}

/** Exposed for testing — evict the in-memory cache. */
export function clearGridCache() {
  gridCache.clear()
}
