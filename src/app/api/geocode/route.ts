import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * Reverse-geocode a photo's GPS coordinates to a German postcode (PROJ-3).
 *
 * Runs server-side (not from the browser) so we control Nominatim's required
 * identifying User-Agent + low request rate, avoid CORS, and keep the geo
 * integration swappable for PROJ-4. Auth-gated: only signed-in users can call it.
 *
 * Always degrades gracefully — no GPS match, a non-Germany location, or an
 * upstream failure returns { postcode: null } so the client falls back to
 * manual entry. Never blocks the scan.
 */

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

// Nominatim's usage policy requires a genuine identifying User-Agent.
const USER_AGENT = 'Sproutly/1.0 (+https://sproutly.app)'
const NOMINATIM_TIMEOUT_MS = 4000

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide numeric lat and lng.' }, { status: 400 })
  }

  const { lat, lng } = parsed.data
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: controller.signal,
    })
    if (!res.ok) {
      return NextResponse.json({ postcode: null }, { status: 502 })
    }
    const data = await res.json()
    const address = data?.address ?? {}

    // Germany-first: discard anything outside DE so the user enters a valid PLZ.
    if (address.country_code !== 'de') {
      return NextResponse.json({ postcode: null })
    }
    const postcode = typeof address.postcode === 'string' && /^\d{5}$/.test(address.postcode)
      ? address.postcode
      : null
    return NextResponse.json({ postcode })
  } catch {
    // Network error or timeout → graceful fallback to manual entry.
    return NextResponse.json({ postcode: null }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
