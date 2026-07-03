/**
 * The single Nominatim (OpenStreetMap) client — forward geocoding for
 * enrichment (postcode → coordinates) and reverse geocoding for the scan form
 * (GPS → postcode). Both directions live here so Nominatim's usage policy
 * (identifying User-Agent, low request rate) is enforced in ONE place, and the
 * provider stays swappable without touching route handlers.
 *
 * Germany-scoped, like every geo source in v1. All functions degrade
 * gracefully — they never throw; callers fall back to manual entry.
 */

// Nominatim's usage policy requires a genuine identifying User-Agent.
const USER_AGENT = 'Sproutly/1.0 (+https://sproutly.app)'
const NOMINATIM_TIMEOUT_MS = 5_000
const BASE_URL = 'https://nominatim.openstreetmap.org'

async function nominatimFetch(url: string): Promise<Response | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: controller.signal,
    })
    return res.ok ? res : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Forward-geocode a German postcode to its centroid coordinates.
 * Returns null when the postcode can't be resolved (no match, upstream
 * failure, or timeout).
 */
export async function forwardGeocodePostcode(
  postcode: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `${BASE_URL}/search?format=json&country=DE&postalcode=${encodeURIComponent(postcode)}&limit=1`
  const res = await nominatimFetch(url)
  if (!res) return null
  try {
    const data: unknown = await res.json()
    if (!Array.isArray(data) || !data[0]) return null
    const lat = parseFloat(String(data[0].lat))
    const lng = parseFloat(String(data[0].lon))
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng }
  } catch {
    return null
  }
}

export type ReverseGeocodeResult =
  /** Upstream reachable; postcode is null for non-DE locations or no usable PLZ. */
  | { ok: true; postcode: string | null }
  /** Upstream failure or timeout — callers may signal a 502 rather than "no match". */
  | { ok: false; postcode: null }

/**
 * Reverse-geocode coordinates to a 5-digit German postcode.
 * Non-Germany locations are discarded (Germany-first: the user should enter a
 * valid PLZ instead).
 */
export async function reverseGeocodeToPostcode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  const url = `${BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
  const res = await nominatimFetch(url)
  if (!res) return { ok: false, postcode: null }
  try {
    const data = await res.json()
    const address = data?.address ?? {}
    if (address.country_code !== 'de') return { ok: true, postcode: null }
    const postcode =
      typeof address.postcode === 'string' && /^\d{5}$/.test(address.postcode)
        ? address.postcode
        : null
    return { ok: true, postcode }
  } catch {
    return { ok: false, postcode: null }
  }
}
