import { z } from 'zod'
import { SUN_OPTIONS, sunLabel, type SunExposure } from '@/lib/scans'
import { MAINTENANCE_OPTIONS, type MaintenanceLevel } from '@/lib/profile'
import { SOIL_OPTIONS, type Soil } from '@/lib/soil'
import { optionValues } from '@/lib/utils'

/**
 * Plant catalogue option sets + validation for PROJ-5 (Plant Database & Admin).
 * Vocabularies are deliberately aligned with the rest of the app so PROJ-6 can
 * match a plant against a scanned site directly:
 *   - sun_tolerance  ⟷ PROJ-3 scan.sun_exposure  (reused SUN_OPTIONS)
 *   - soil_compatibility ⟷ PROJ-4 enrichment soil buckets
 *   - maintenance_level  ⟷ PROJ-2 profile.maintenance_preference (reused MAINTENANCE_OPTIONS)
 *   - min_hardiness_zone ⟷ PROJ-4 whole-number hardiness zone (numeric compare: site_zone >= min)
 * The UI is built against this contract; reads/writes error until the PROJ-5 backend
 * migration creates the public.plants table (same staged flow as PROJ-2/PROJ-3).
 */

export { SUN_OPTIONS, sunLabel, MAINTENANCE_OPTIONS, SOIL_OPTIONS }
export type { SunExposure, Soil, MaintenanceLevel }

/**
 * Structural planting layers (PROJ-6). Drives the ~60/30/10 layered plan
 * composition and the grouped plan view (Trees · Shrubs · Perennials · Groundcovers).
 */
export const PLANT_TYPE_OPTIONS = [
  { value: 'groundcover', label: 'Groundcover', plural: 'Groundcovers' },
  { value: 'perennial', label: 'Perennial', plural: 'Perennials' },
  { value: 'shrub', label: 'Shrub', plural: 'Shrubs' },
  { value: 'tree', label: 'Tree', plural: 'Trees' },
] as const

export type PlantType = (typeof PLANT_TYPE_OPTIONS)[number]['value']

/** Display / iteration order for layered plans — tallest layer first. */
export const LAYER_DISPLAY_ORDER: PlantType[] = ['tree', 'shrub', 'perennial', 'groundcover']

/** Whole-number hardiness zones (aligned to PROJ-4's output). Germany sits ~5–8; the
 *  wider range lets the catalogue hold hardier (lower-min-zone) plants too. */
export const ZONE_MIN = 1
export const ZONE_MAX = 12
export const ZONE_OPTIONS = Array.from({ length: ZONE_MAX - ZONE_MIN + 1 }, (_, i) => ZONE_MIN + i)

export const COMMON_NAME_MAX = 100
export const LATIN_NAME_MAX = 120
export const NOTES_MAX = 2000
/** Mature size in centimetres (covers groundcover → small trees). */
export const SIZE_MIN_CM = 1
export const SIZE_MAX_CM = 3000

export const PLANTS_TABLE = 'plants'

/** A row of public.plants as the UI reads it. */
export type Plant = {
  id: string
  common_name: string
  latin_name: string
  sun_tolerance: SunExposure[]
  soil_compatibility: Soil[]
  min_hardiness_zone: number
  mature_height_cm: number
  mature_spread_cm: number
  maintenance_level: MaintenanceLevel
  plant_type: PlantType
  native: boolean
  image_url: string | null
  care_notes: string | null
  created_at: string
  updated_at: string | null
}

export const plantSchema = z.object({
  common_name: z
    .string()
    .trim()
    .min(1, 'Enter the common name')
    .max(COMMON_NAME_MAX, `Keep it under ${COMMON_NAME_MAX} characters`),
  latin_name: z
    .string()
    .trim()
    .min(1, 'Enter the Latin name')
    .max(LATIN_NAME_MAX, `Keep it under ${LATIN_NAME_MAX} characters`),
  sun_tolerance: z
    .array(z.enum(optionValues(SUN_OPTIONS)))
    .min(1, 'Pick at least one sun condition'),
  soil_compatibility: z
    .array(z.enum(optionValues(SOIL_OPTIONS)))
    .min(1, 'Pick at least one soil type'),
  min_hardiness_zone: z
    .number({ message: 'Choose the minimum hardiness zone' })
    .int('Use a whole zone number')
    .min(ZONE_MIN, `Zone must be ${ZONE_MIN} or higher`)
    .max(ZONE_MAX, `Zone must be ${ZONE_MAX} or lower`),
  mature_height_cm: z
    .number({ message: 'Enter the mature height' })
    .int('Use a whole number of cm')
    .min(SIZE_MIN_CM, `Height must be at least ${SIZE_MIN_CM} cm`)
    .max(SIZE_MAX_CM, `Height must be ${SIZE_MAX_CM} cm or less`),
  mature_spread_cm: z
    .number({ message: 'Enter the mature spread' })
    .int('Use a whole number of cm')
    .min(SIZE_MIN_CM, `Spread must be at least ${SIZE_MIN_CM} cm`)
    .max(SIZE_MAX_CM, `Spread must be ${SIZE_MAX_CM} cm or less`),
  maintenance_level: z.enum(optionValues(MAINTENANCE_OPTIONS), {
    message: 'Choose a maintenance level',
  }),
  plant_type: z.enum(optionValues(PLANT_TYPE_OPTIONS), {
    message: 'Choose the plant type',
  }),
  native: z.boolean(),
  image_url: z
    .string()
    .trim()
    .optional()
    // BUG-2 fix: http(s) only — `z.string().url()` also accepts javascript:/data:.
    .refine((v) => !v || isHttpUrl(v), 'Enter a valid http(s) URL (https://…)'),
  care_notes: z
    .string()
    .trim()
    .max(NOTES_MAX, `Keep notes under ${NOTES_MAX} characters`)
    .optional(),
})
export type PlantValues = z.infer<typeof plantSchema>

const SOIL_LABELS = Object.fromEntries(SOIL_OPTIONS.map((o) => [o.value, o.label])) as Record<Soil, string>
const MAINTENANCE_LABELS = Object.fromEntries(
  MAINTENANCE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<MaintenanceLevel, string>

const PLANT_TYPE_LABELS = Object.fromEntries(
  PLANT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PlantType, string>
const PLANT_TYPE_PLURALS = Object.fromEntries(
  PLANT_TYPE_OPTIONS.map((o) => [o.value, o.plural]),
) as Record<PlantType, string>

export const soilLabel = (v: Soil) => SOIL_LABELS[v] ?? v
export const maintenanceLabel = (v: MaintenanceLevel) => MAINTENANCE_LABELS[v] ?? v
export const plantTypeLabel = (v: PlantType) => PLANT_TYPE_LABELS[v] ?? v
export const plantTypePlural = (v: PlantType) => PLANT_TYPE_PLURALS[v] ?? v

/** "Full sun · Partial sun" — the joined human labels for a plant's tolerated set. */
export function sunToleranceSummary(values: SunExposure[]): string {
  return values.map(sunLabel).join(' · ')
}

/**
 * True only for well-formed http(s) URLs — blocks `javascript:`/`data:` schemes
 * (PROJ-5 BUG-2). Used by `plantSchema` and the safe-image guard below.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Returns the URL only when it is a safe http(s) URL, else null (render guard). */
export function safeImageUrl(value: string | null | undefined): string | null {
  return value && isHttpUrl(value) ? value.trim() : null
}
