import type { Soil } from '@/lib/soil'
import type { Moisture } from '@/lib/moisture'
import type { MaintenanceLevel, Plant } from '@/lib/plants'

/**
 * PROJ-13 Survival Confidence Band — the single source of truth for every band
 * anywhere in the app. PURE and deterministic (same inputs → same band; no I/O,
 * no dates, no randomness), so it runs identically server-side (engine ranking)
 * and in the browser (plan view, add-plant picker, live recompute on edit) —
 * surfaces can never disagree because they all render this module's output.
 *
 * The model (see the PROJ-13 spec):
 *   - Every banded plant already passed the hard sun/zone/fit filters, so no
 *     band ever means "likely to die".
 *   - KNOWN MISMATCHES (soil conflict, moisture conflict) are heavy: they force
 *     "worth_checking" and can never be offset.
 *   - DATA GAPS (soil unknown, zone unconfirmed, unverified AI traits, postcode
 *     location) are mild: one un-offset gap = "good", two or more = "worth_checking".
 *   - BOOSTS (native, maintenance match) each offset ONE gap, never a mismatch,
 *     and their absence never penalizes.
 *   - Missing data is SKIPPED, never guessed: a plant without a moisture trait,
 *     or a plan snapshot without rainfall, simply isn't evaluated on that factor.
 *
 * Results carry machine-readable reason codes; all user-facing copy (and the
 * "no percentages, no guarantee" wording rule) lives in the display layer.
 */

// ─── Bands ────────────────────────────────────────────────────────────────────

export const CONFIDENCE_BANDS = ['high', 'good', 'worth_checking'] as const
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number]

/** Sort weight: lower = more confident. Used by the engine's per-layer ranking. */
export const BAND_RANK: Record<ConfidenceBand, number> = {
  high: 0,
  good: 1,
  worth_checking: 2,
}

// ─── Rainfall buckets (PROJ-13 open question, resolved here) ─────────────────
// Source: DWD multi-annual precipitation grids for Germany (reference period
// 1991–2020, opendata.dwd.de) — the values scan_enrichment.rainfall_mm is read
// from. Germany's area mean is ~800 mm/yr; the driest lowlands (Brandenburg,
// Magdeburger Börde) sit at ~450–550 mm; upland and pre-alpine regions exceed
// 1000 mm up to ~2000+ mm. Buckets are deliberately wide so only genuinely dry
// or genuinely wet sites leave "medium" — and only OPPOSITE extremes (dry plant
// on a high-rainfall site, wet plant on a low-rainfall site) ever conflict.
export const RAINFALL_LOW_MAX_MM = 600
export const RAINFALL_HIGH_MIN_MM = 1000

export type RainfallLevel = 'low' | 'medium' | 'high'

/** Bucket raw annual rainfall (mm) into the three site moisture levels. */
export function rainfallLevel(mm: number): RainfallLevel {
  if (mm <= RAINFALL_LOW_MAX_MM) return 'low'
  if (mm >= RAINFALL_HIGH_MIN_MM) return 'high'
  return 'medium'
}

/**
 * A survivability conflict between a plant's water needs and the site's rainfall.
 * Conservative by design: only opposite extremes conflict; 'moist' plants and
 * 'medium' sites never do.
 */
export function moistureConflicts(moisture: Moisture, level: RainfallLevel): boolean {
  return (moisture === 'dry' && level === 'high') || (moisture === 'wet' && level === 'low')
}

// ─── Reason codes (machine-readable; the UI owns the copy) ───────────────────

/** Known survivability mismatches — heavy, force "worth_checking", un-offsettable. */
export const MISMATCH_CODES = ['soil-mismatch', 'moisture-conflict'] as const
export type MismatchCode = (typeof MISMATCH_CODES)[number]

/** Data gaps — mild; one un-offset gap = "good", two or more = "worth_checking". */
export const GAP_CODES = [
  'soil-unknown',
  'zone-unconfirmed',
  'traits-unverified',
  'location-approximate',
] as const
export type GapCode = (typeof GAP_CODES)[number]

/** Boosts actually consumed to offset a gap (never present alongside a mismatch). */
export const OFFSET_CODES = ['native-offset', 'maintenance-offset'] as const
export type OffsetCode = (typeof OFFSET_CODES)[number]

/** Positively confirmed factors ("reasons naming the matched factors"). */
export const MATCH_CODES = ['sun-match', 'zone-match', 'soil-match', 'moisture-match'] as const
export type MatchCode = (typeof MATCH_CODES)[number]

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type LocationBasis = 'gps' | 'postcode_centroid'

/**
 * The site facts the band reads — sourced from the PLAN SNAPSHOT (not the live
 * scan), consistent with how PROJ-7 keeps stale plans honest. Every field is
 * nullable; null always means "not captured → skip or count as the gap the
 * model defines", never "guess".
 */
export type ConfidenceSite = {
  soil: Soil | null
  zone: number | null
  /** Raw annual rainfall in mm (bucketed here at read time). Null = skip moisture. */
  rainfallMm: number | null
  locationBasis: LocationBasis | null
  maintenance: MaintenanceLevel | null
}

/** The plant traits the band reads — live from the catalogue, never snapshotted. */
export type ConfidencePlant = Pick<
  Plant,
  'soil_compatibility' | 'maintenance_level' | 'native' | 'moisture' | 'ai_origin_fields'
>

// ─── Per-plant band ──────────────────────────────────────────────────────────

export type PlantConfidence = {
  band: ConfidenceBand
  /** Known conflicts (any entry forces band = 'worth_checking'). */
  mismatches: MismatchCode[]
  /** ALL data gaps found — including ones a boost offset (the UI stays honest about them). */
  gaps: GapCode[]
  /** Boosts consumed, one per gap, native first. Empty when there's a mismatch. */
  offsets: OffsetCode[]
  /** Positively confirmed factors, for "why we're confident" copy. */
  matches: MatchCode[]
}

/**
 * Compute one plant's band for one site. The plant is assumed to have passed
 * the engine's hard filters already (bands are only ever shown on hard-filter
 * survivors — the plan's lines and the picker's candidates).
 */
export function plantConfidence(plant: ConfidencePlant, site: ConfidenceSite): PlantConfidence {
  const mismatches: MismatchCode[] = []
  const gaps: GapCode[] = []
  // Sun is always a match by construction: every banded plant passed the sun hard filter.
  const matches: MatchCode[] = ['sun-match']

  // Soil — known site soil either matches or conflicts; unknown is a gap.
  if (site.soil === null) {
    gaps.push('soil-unknown')
  } else if (plant.soil_compatibility.includes(site.soil)) {
    matches.push('soil-match')
  } else {
    mismatches.push('soil-mismatch')
  }

  // Winter zone — confirmed means the hard filter really ran; unconfirmed is a gap.
  if (site.zone === null) {
    gaps.push('zone-unconfirmed')
  } else {
    matches.push('zone-match')
  }

  // Moisture vs rainfall — evaluated only when BOTH sides are known ("skipped,
  // not punished": a null plant trait is a curated coverage gap, a null site
  // rainfall is a site-level gap already reflected via enrichment factors).
  const moisture = plant.moisture ?? null
  if (site.rainfallMm !== null && moisture !== null) {
    if (moistureConflicts(moisture, rainfallLevel(site.rainfallMm))) {
      mismatches.push('moisture-conflict')
    } else {
      matches.push('moisture-match')
    }
  }

  // Unverified AI traits — positively marks survival-critical guesses (unlike a
  // missing trait), so it IS a gap.
  if ((plant.ai_origin_fields ?? []).length > 0) gaps.push('traits-unverified')

  // Location from a postcode centroid — the site's soil/climate reads are
  // approximate. GPS and null (old plans) add nothing.
  if (site.locationBasis === 'postcode_centroid') gaps.push('location-approximate')

  // Boosts: each offsets ONE gap; never a mismatch; absence never penalizes.
  const offsets: OffsetCode[] = []
  if (mismatches.length === 0 && gaps.length > 0) {
    if (plant.native) offsets.push('native-offset')
    if (
      offsets.length < gaps.length &&
      site.maintenance !== null &&
      plant.maintenance_level === site.maintenance
    ) {
      offsets.push('maintenance-offset')
    }
  }

  const unoffsetGaps = gaps.length - offsets.length
  const band: ConfidenceBand =
    mismatches.length > 0 || unoffsetGaps >= 2 ? 'worth_checking' : unoffsetGaps === 1 ? 'good' : 'high'

  return { band, mismatches, gaps, offsets, matches }
}

// ─── Site-level gaps (headline attribution) ──────────────────────────────────

/**
 * The gaps that come from the SITE, not any plant — for the headline's "we
 * couldn't confirm your soil type" attribution, so a site-wide gap doesn't read
 * as 11 mediocre plants.
 */
export function siteGaps(site: ConfidenceSite): GapCode[] {
  const gaps: GapCode[] = []
  if (site.soil === null) gaps.push('soil-unknown')
  if (site.zone === null) gaps.push('zone-unconfirmed')
  if (site.locationBasis === 'postcode_centroid') gaps.push('location-approximate')
  return gaps
}

// ─── Plan-level headline ─────────────────────────────────────────────────────

export type PlanConfidenceSummary = {
  /** The majority band (ties go to the LOWER-confidence band — cautious, honest). */
  band: ConfidenceBand
  /** How many plants hold each band. */
  counts: Record<ConfidenceBand, number>
  total: number
  /** Non-headline bands with their counts, least confident first — never hidden. */
  exceptions: { band: ConfidenceBand; count: number }[]
}

/**
 * Aggregate per-plant bands into the plan headline: the band most plants hold,
 * with every other band called out explicitly ("High confidence — 9 of 11
 * plants; 2 worth checking"). Returns null for an empty plan — a band on
 * nothing is noise.
 */
export function summarizePlanConfidence(bands: ConfidenceBand[]): PlanConfidenceSummary | null {
  if (bands.length === 0) return null

  const counts: Record<ConfidenceBand, number> = { high: 0, good: 0, worth_checking: 0 }
  for (const b of bands) counts[b] += 1

  // Majority band; on a tie the LOWER-confidence band wins (never oversell).
  let headline: ConfidenceBand = 'high'
  for (const b of CONFIDENCE_BANDS) {
    if (counts[b] >= counts[headline]) headline = b
  }

  const exceptions = [...CONFIDENCE_BANDS]
    .reverse()
    .filter((b) => b !== headline && counts[b] > 0)
    .map((b) => ({ band: b, count: counts[b] }))

  return { band: headline, counts, total: bands.length, exceptions }
}
