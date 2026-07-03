import { z } from 'zod'
import { optionValues } from '@/lib/utils'
import type { Soil } from '@/lib/soil'

/**
 * Scan option sets + validation for PROJ-3 (Photo Upload & Space Scan).
 * These values mirror the check constraints the PROJ-3 backend migration will
 * put on the public.scans table. The UI is built against this contract; reads
 * and writes will error until the migration is applied (same as PROJ-2's flow).
 */

export const SUN_OPTIONS = [
  { value: 'full', label: 'Full sun' },
  { value: 'partial', label: 'Partial sun' },
  { value: 'shade', label: 'Shade' },
] as const

export const SURFACE_OPTIONS = [
  { value: 'gravel', label: 'Gravel' },
  { value: 'lawn', label: 'Lawn' },
  { value: 'soil', label: 'Bare soil' },
  { value: 'paved', label: 'Paved' },
  { value: 'mixed', label: 'Mixed' },
] as const

export const SPACE_TYPE_OPTIONS = [
  { value: 'front_garden', label: 'Front garden' },
  { value: 'back_garden', label: 'Back garden' },
  { value: 'balcony', label: 'Balcony' },
  { value: 'bed', label: 'Bed / border' },
] as const

export type SunExposure = (typeof SUN_OPTIONS)[number]['value']
export type Surface = (typeof SURFACE_OPTIONS)[number]['value']
export type SpaceType = (typeof SPACE_TYPE_OPTIONS)[number]['value']

export const NAME_MAX = 60
export const AREA_MIN = 1
export const AREA_MAX = 5000

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
export const PHOTO_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]
/** The `accept` attribute for the file input (HEIC variants included for iOS). */
export const PHOTO_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

export const STORAGE_BUCKET = 'photos'

/** Fixed per-scan object path → one image file per scan (no orphan pile-up). */
export function scanPhotoPath(userId: string, scanId: string): string {
  return `${userId}/scans/${scanId}/photo`
}

/** A row of public.scans as the UI reads it. */
export type Scan = {
  id: string
  /** Short, URL-facing code (PROJ-3). The id stays the PK for all internal references. */
  short_code: string
  user_id: string
  name: string | null
  photo_path: string | null
  postcode: string | null
  lat: number | null
  lng: number | null
  sun_exposure: SunExposure
  surface: Surface
  space_type: SpaceType
  area_sqm: number
  taken_at: string | null
  created_at: string
  updated_at: string | null
}

export type EnrichmentFieldStatus = 'pending' | 'success' | 'unavailable'
export type EnrichmentOverallStatus = 'pending' | 'complete' | 'partial' | 'failed'

/** A row of public.scan_enrichment as the UI reads it (PROJ-4). */
export type ScanEnrichment = {
  id: string
  scan_id: string
  user_id: string
  status: EnrichmentOverallStatus
  requested_at: string
  soil_type: Soil | null
  soil_status: EnrichmentFieldStatus
  rainfall_mm: number | null
  annual_min_temp: number | null
  frost_days: number | null
  climate_status: EnrichmentFieldStatus
  climate_period: string | null
  hardiness_zone: string | null
  zone_status: EnrichmentFieldStatus
  location_basis: 'gps' | 'postcode_centroid' | null
  created_at: string
  updated_at: string | null
}

export const scanSchema = z.object({
  name: z.string().trim().max(NAME_MAX, `Keep the name under ${NAME_MAX} characters`),
  postcode: z.string().regex(/^\d{5}$/, 'Enter a 5-digit German postcode'),
  sun_exposure: z.enum(optionValues(SUN_OPTIONS), { message: 'Choose the sun exposure' }),
  surface: z.enum(optionValues(SURFACE_OPTIONS), { message: 'Choose the current surface' }),
  space_type: z.enum(optionValues(SPACE_TYPE_OPTIONS), { message: 'Choose the space type' }),
  area_sqm: z
    .number({ message: 'Enter an approximate area' })
    .int('Use a whole number of m²')
    .min(AREA_MIN, `Area must be at least ${AREA_MIN} m²`)
    .max(AREA_MAX, `Area must be ${AREA_MAX} m² or less`),
})
export type ScanValues = z.infer<typeof scanSchema>

/** Validate a chosen photo against the type/size rules. Returns an error message or null. */
export function validatePhotoFile(file: File): string | null {
  // Some browsers report HEIC files with an empty type; fall back to the extension.
  const isHeicByName = /\.(heic|heif)$/i.test(file.name)
  if (!PHOTO_ACCEPTED_TYPES.includes(file.type) && !isHeicByName) {
    return 'Please choose a JPEG, PNG, WebP, or HEIC image.'
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return 'Image must be 10 MB or smaller.'
  }
  return null
}

const SUN_LABELS = Object.fromEntries(SUN_OPTIONS.map((o) => [o.value, o.label]))
const SURFACE_LABELS = Object.fromEntries(SURFACE_OPTIONS.map((o) => [o.value, o.label]))
const SPACE_TYPE_LABELS = Object.fromEntries(SPACE_TYPE_OPTIONS.map((o) => [o.value, o.label]))

export const sunLabel = (v: SunExposure) => SUN_LABELS[v] ?? v
export const surfaceLabel = (v: Surface) => SURFACE_LABELS[v] ?? v
export const spaceTypeLabel = (v: SpaceType) => SPACE_TYPE_LABELS[v] ?? v

/** Display title for a scan — its name, or the space type as a fallback. */
export function scanTitle(scan: Pick<Scan, 'name' | 'space_type'>): string {
  return scan.name?.trim() || spaceTypeLabel(scan.space_type)
}

/** One-line summary used on the list cards ("Full sun · Gravel · 20 m²"). */
export function scanSummary(scan: Pick<Scan, 'sun_exposure' | 'surface' | 'area_sqm'>): string {
  return `${sunLabel(scan.sun_exposure)} · ${surfaceLabel(scan.surface)} · ${scan.area_sqm} m²`
}
