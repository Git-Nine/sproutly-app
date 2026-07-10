'use client'

import { ChevronDown, CircleCheck, Eye, ShieldCheck, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { soilLabel } from '@/lib/plants'
import {
  siteGaps,
  type ConfidenceBand,
  type ConfidencePlant,
  type ConfidenceSite,
  type GapCode,
  type MatchCode,
  type MismatchCode,
  type OffsetCode,
  type PlanConfidenceSummary,
  type PlantConfidence,
} from '@/lib/plan-confidence'

/**
 * PROJ-13 — the display layer for the survival confidence band. The pure module
 * (`plan-confidence.ts`) returns bands + machine-readable reason codes; ALL
 * user-facing wording lives here, and here alone, so the feature's copy rules
 * are enforced in one place: no percentages, no numeric scores, nothing that
 * promises a guarantee — and "worth checking" must never read as "likely to
 * die" (every banded plant already passed the hard survival filters).
 *
 * Three thin renderers, all fed by module output so surfaces can't disagree:
 *   - ConfidenceChip      — the band pill (add-plant picker rows)
 *   - ConfidenceBadge     — chip + tap-to-expand plain-language reasons (plan lines)
 *   - PlanConfidenceHeadline — majority band + exception counts + site-level
 *     attribution ("we couldn't confirm your soil type"), near the plan intro
 */

// ─── Band presentation ────────────────────────────────────────────────────────
// Colour is never the only carrier: every band has its own icon and label text.

const BAND_META: Record<
  ConfidenceBand,
  { label: string; Icon: LucideIcon; chipClass: string; iconClass: string }
> = {
  high: {
    label: 'High confidence',
    Icon: ShieldCheck,
    chipClass: 'bg-primary/10 text-primary',
    iconClass: 'text-primary',
  },
  good: {
    label: 'Good match',
    Icon: CircleCheck,
    chipClass: 'bg-[#7C9A6E]/15 text-[#4E6442]',
    iconClass: 'text-[#4E6442]',
  },
  worth_checking: {
    label: 'Worth checking',
    Icon: Eye,
    chipClass: 'bg-[#C2683F]/10 text-[#A85A32]',
    iconClass: 'text-[#A85A32]',
  },
}

export const bandLabel = (band: ConfidenceBand) => BAND_META[band].label

// ─── Reason copy (codes → plain language) ────────────────────────────────────

/** One line under the chip, before the reasons. Sets the honest tone per band. */
function bandTagline(c: PlantConfidence): string {
  if (c.band === 'high') return 'Everything we checked lines up for your space.'
  if (c.band === 'good') return 'A solid pick — one detail we couldn’t fully confirm.'
  return c.mismatches.length > 0
    ? 'Passed our core survival checks — worth a quick look before planting.'
    : 'Passed our core survival checks — we just know a little less about this match.'
}

/** Mismatches name the conflict AND what to do about it — never a death sentence. */
function mismatchCopy(
  code: MismatchCode,
  plant: BadgePlant,
  site: ConfidenceSite,
): string {
  switch (code) {
    case 'soil-mismatch': {
      const soil = site.soil ? `${soilLabel(site.soil).toLowerCase()} soil` : 'your soil'
      const hint = plant.care_notes ? ' — see the care tips below' : ''
      return `Not a natural match for your ${soil}; some soil preparation at planting helps it settle in${hint}.`
    }
    case 'moisture-conflict':
      return plant.moisture === 'dry'
        ? 'Prefers drier ground than your area’s rainfall — give it a spot with good drainage.'
        : 'Likes more moisture than your area’s rainfall usually brings — water it in dry spells.'
  }
}

const GAP_COPY: Record<GapCode, string> = {
  'soil-unknown': 'We couldn’t confirm your soil type, so this match is judged with a little less data.',
  'zone-unconfirmed': 'Your winter-hardiness zone isn’t confirmed, so we know less about winter fit.',
  'traits-unverified': 'A few of this plant’s catalogue details are still awaiting expert verification.',
  'location-approximate': 'Your location comes from your postcode area, so local readings are approximate.',
}

const OFFSET_COPY: Record<OffsetCode, string> = {
  'native-offset': 'Native to your region — locally adapted, which makes up for a data gap.',
  'maintenance-offset': 'Fits the care level you asked for, which makes up for a data gap.',
}

/** Short names for the positively confirmed factors, joined into one line. */
const MATCH_NAMES: Record<MatchCode, string> = {
  'sun-match': 'sunlight',
  'soil-match': 'your soil',
  'zone-match': 'your winter zone',
  'moisture-match': 'local rainfall',
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ─── Chip (picker rows; also the badge trigger face) ─────────────────────────

export function ConfidenceChip({ band, className }: { band: ConfidenceBand; className?: string }) {
  const { label, Icon, chipClass } = BAND_META[band]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        chipClass,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}

// ─── Per-plant badge (plan lines): chip + expandable reasons ─────────────────

type BadgePlant = ConfidencePlant & { care_notes?: string | null }

export function ConfidenceBadge({
  confidence,
  plant,
  site,
  className,
}: {
  confidence: PlantConfidence
  plant: BadgePlant
  site: ConfidenceSite
  className?: string
}) {
  const { label, Icon, chipClass } = BAND_META[confidence.band]
  const matchesLine =
    confidence.matches.length > 0
      ? `Checks out: ${listJoin(confidence.matches.map((m) => MATCH_NAMES[m]))}.`
      : null

  return (
    <Collapsible className={className}>
      <CollapsibleTrigger
        className={cn(
          'group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
          chipClass,
        )}
        aria-label={`${label} — show why`}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {label}
        <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pt-1.5 text-xs leading-relaxed">
        <p className="text-foreground">{bandTagline(confidence)}</p>
        {(confidence.mismatches.length > 0 ||
          confidence.gaps.length > 0 ||
          confidence.offsets.length > 0) && (
          <ul className="space-y-1">
            {confidence.mismatches.map((code) => (
              <li key={code} className="text-[#A85A32]">
                {mismatchCopy(code, plant, site)}
              </li>
            ))}
            {confidence.gaps.map((code) => (
              <li key={code} className="text-muted-foreground">
                {GAP_COPY[code]}
              </li>
            ))}
            {confidence.offsets.map((code) => (
              <li key={code} className="text-muted-foreground">
                {OFFSET_COPY[code]}
              </li>
            ))}
          </ul>
        )}
        {matchesLine && <p className="text-muted-foreground">{matchesLine}</p>}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ─── Plan-level headline ─────────────────────────────────────────────────────

/** Site-level gap attribution: the gap belongs to our data, not the plants. */
const SITE_GAP_COPY: Record<GapCode, string> = {
  'soil-unknown': 'We couldn’t confirm your soil type — that’s a gap in our site data, not in the plants.',
  'zone-unconfirmed': 'We couldn’t confirm your winter-hardiness zone.',
  'traits-unverified': '', // never site-level; keys kept aligned with GapCode
  'location-approximate': 'Your location comes from your postcode area, so site readings are approximate.',
}

function exceptionPhrase(band: ConfidenceBand, count: number): string {
  if (band === 'worth_checking') return 'worth checking'
  if (band === 'good') return count === 1 ? 'a good match' : 'good matches'
  return 'high confidence'
}

export function PlanConfidenceHeadline({
  summary,
  site,
  className,
}: {
  summary: PlanConfidenceSummary
  site: ConfidenceSite
  className?: string
}) {
  const { label, Icon, iconClass } = BAND_META[summary.band]
  const gaps = siteGaps(site)

  const allSame = summary.counts[summary.band] === summary.total
  const countParts = [
    allSame
      ? summary.total === 1
        ? 'your plant'
        : `all ${summary.total} plants`
      : `${summary.counts[summary.band]} of ${summary.total} plants`,
    ...summary.exceptions.map((e) => `${e.count} ${exceptionPhrase(e.band, e.count)}`),
  ]

  // With full site data, say what was actually checked (evidence, calmly).
  const checkedFacts = ['your sunlight']
  if (site.soil) checkedFacts.push(`${soilLabel(site.soil).toLowerCase()} soil`)
  if (site.zone != null) checkedFacts.push(`winter zone ${site.zone}`)
  if (site.rainfallMm != null) checkedFacts.push('local rainfall')

  return (
    <Card className={className}>
      <CardContent className="space-y-2 p-4">
        <p className="font-mono text-[11px] uppercase tracking-wider text-label">
          Survival confidence
        </p>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-5 w-5 shrink-0', iconClass)} aria-hidden />
          <p className="font-serif text-xl">{label}</p>
        </div>
        <p className="text-sm text-foreground">
          {capitalize(countParts.join(' · '))}
          {summary.exceptions.length > 0 && ' — the band on each plant below says why.'}
        </p>
        {gaps.length > 0 ? (
          <ul className="space-y-1">
            {gaps.map((g) => (
              <li key={g} className="text-sm text-muted-foreground">
                {SITE_GAP_COPY[g]}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Checked against {listJoin(checkedFacts)}.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Every plant here already passed our survival checks for sun, winter and space — the bands
          show how much we could confirm on top.
        </p>
      </CardContent>
    </Card>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
