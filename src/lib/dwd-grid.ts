import { gunzipSync } from 'node:zlib'

/**
 * DWD CDC multi-annual ASCII grid (.asc.gz) download, parse, and point lookup.
 * Used by PROJ-4 environmental enrichment for precipitation, air temperature
 * minimum, and frost-day count lookups.
 *
 * Grid CRS assumed to be geographic WGS84 (lat/lng) based on research findings.
 * Verify the `xllcorner`/`yllcorner` values in the file header at implementation:
 * if they look like large projected coordinates (e.g. 3,000,000+), a reprojection
 * step using `proj4` is needed — see Open Questions in PROJ-4-environmental-data-enrichment.md.
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

/** Return the grid value at the given lat/lng. Returns null on out-of-bounds or NODATA. */
export function gridValueAt(grid: AscGrid, lat: number, lng: number): number | null {
  const col = Math.floor((lng - grid.xllcorner) / grid.cellsize)
  // ASC row 0 = top of the grid (north), so rows increase southward.
  const row = Math.floor((grid.yllcorner + grid.nrows * grid.cellsize - lat) / grid.cellsize)

  if (col < 0 || col >= grid.ncols || row < 0 || row >= grid.nrows) return null

  const val = grid.values[row * grid.ncols + col]
  if (val === undefined || val === grid.nodata) return null
  return val
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
