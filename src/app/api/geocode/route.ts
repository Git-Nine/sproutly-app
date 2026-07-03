import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseJson, requireUser } from '@/lib/api'
import { reverseGeocodeToPostcode } from '@/lib/nominatim'

/**
 * Reverse-geocode a photo's GPS coordinates to a German postcode (PROJ-3).
 *
 * Runs server-side (not from the browser) so we control Nominatim's required
 * identifying User-Agent + low request rate, avoid CORS, and keep the geo
 * integration swappable — the actual client lives in src/lib/nominatim.ts,
 * shared with enrichment's forward geocoding. Auth-gated: only signed-in
 * users can call it.
 *
 * Always degrades gracefully — no GPS match, a non-Germany location, or an
 * upstream failure returns { postcode: null } so the client falls back to
 * manual entry. Never blocks the scan.
 */

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response

  const body = await parseJson(request, bodySchema)
  if (body.response) return body.response
  const { lat, lng } = body.data

  const result = await reverseGeocodeToPostcode(lat, lng)
  if (!result.ok) {
    // Network error or timeout → graceful fallback to manual entry.
    return NextResponse.json({ postcode: null }, { status: 502 })
  }
  return NextResponse.json({ postcode: result.postcode })
}
