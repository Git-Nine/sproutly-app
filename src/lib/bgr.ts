/**
 * BGR BÜK200 soil-type point lookup via ArcGIS REST Identify.
 * Used by PROJ-4 environmental enrichment.
 *
 * The BÜK200 is a 1:200,000-scale soil survey — results are regional estimates,
 * not garden-plot accuracy. Display to users as "regional estimate".
 *
 * The exact attribute field names and soil-type code values returned by the
 * BÜK200 Identify response must be verified against a live response at
 * implementation time. Common candidates: BKTYP, SG_KURZ, LEGENDE, BGRUP.
 * Inspect a real response by running:
 *   curl "https://services.bgr.de/arcgis/rest/services/boden/buek200/MapServer/identify?
 *     geometry={"x":13.405,"y":52.52}&geometryType=esriGeometryPoint&sr=4326&
 *     layers=visible&mapExtent=5,47,16,56&imageDisplay=400,400,96&tolerance=2&f=json"
 */

const BGR_BASE = 'https://services.bgr.de/arcgis/rest/services/boden/buek200/MapServer'
const BGR_TIMEOUT_MS = 8_000

export type SoilType = 'sand' | 'loam' | 'clay' | 'silt' | 'peat'

/** Fetch the dominant soil type at the given WGS84 coordinate from BGR BÜK200. */
export async function fetchSoilType(lat: number, lng: number): Promise<SoilType | null> {
  const mapExtent = `${lng - 0.1},${lat - 0.1},${lng + 0.1},${lat + 0.1}`

  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'visible',
    mapExtent,
    imageDisplay: '400,400,96',
    tolerance: '2',
    returnGeometry: 'false',
    f: 'json',
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BGR_TIMEOUT_MS)
  try {
    const res = await fetch(`${BGR_BASE}/identify?${params}`, {
      signal: controller.signal,
    })
    if (!res.ok) return null

    const data: unknown = await res.json()
    return extractSoilType(data)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function extractSoilType(response: unknown): SoilType | null {
  if (!response || typeof response !== 'object') return null
  const data = response as { results?: Array<{ attributes?: Record<string, unknown> }> }
  if (!Array.isArray(data.results) || data.results.length === 0) return null

  for (const result of data.results) {
    const attrs = result.attributes ?? {}

    // Try known BÜK200 attribute fields in priority order.
    // Verify exact field names against a live response before production deploy.
    const raw =
      attrs['BKTYP'] ??
      attrs['SG_KURZ'] ??
      attrs['Bodentyp'] ??
      attrs['LEGENDE'] ??
      attrs['BGRUP']

    if (typeof raw === 'string') {
      const mapped = mapToSoilType(raw.toLowerCase())
      if (mapped) return mapped
    }
  }
  return null
}

function mapToSoilType(code: string): SoilType | null {
  // German soil classification (KA5) abbreviations → our five-bucket type.
  // Patterns are conservative — prefer no match over a wrong match.
  // Verify and extend against actual BÜK200 codes before production deploy.
  if (/torf|moor|anmoor|\bh\b|\bmo\b/.test(code)) return 'peat'
  if (/\bton\b|\btt\b|\bts\b|\btl\b|\bta\b/.test(code)) return 'clay'
  if (/schluff|\buu\b|\bus\b|\but\b|\bul\b/.test(code)) return 'silt'
  if (/lehm|\bll\b|\bls\b|\blu\b|\blt\b|\blts\b/.test(code)) return 'loam'
  if (/sand|\bss\b|\bsl\b|\bsu\b|\bst\b/.test(code)) return 'sand'
  return null
}
