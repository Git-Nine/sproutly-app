import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  ConfidenceBadge,
  ConfidenceChip,
  PlanConfidenceHeadline,
  bandLabel,
} from './plan-confidence-view'
import {
  plantConfidence,
  summarizePlanConfidence,
  type ConfidenceBand,
  type ConfidencePlant,
  type ConfidenceSite,
} from '@/lib/plan-confidence'

/**
 * PROJ-13 — the display layer for the survival confidence band. Asserts the
 * observable copy rules the spec fixes: bands always shipped with plain-language
 * reasons, "worth checking" never reading as "likely to die", site-wide gaps
 * attributed to the SITE not the plants, and — the hard rule — no percentage,
 * no numeric score, no wording promising a guarantee, anywhere.
 */

type BadgePlant = ConfidencePlant & { care_notes: string | null }

function plant(over: Partial<BadgePlant> = {}): BadgePlant {
  return {
    soil_compatibility: ['loam', 'sand'],
    maintenance_level: 'low',
    native: false,
    moisture: null,
    ai_origin_fields: [],
    care_notes: null,
    ...over,
  }
}

function site(over: Partial<ConfidenceSite> = {}): ConfidenceSite {
  return {
    soil: 'loam',
    zone: 8,
    rainfallMm: 800,
    locationBasis: 'gps',
    maintenance: 'low',
    ...over,
  }
}

/** Render a badge and expand its reasons (the copy under test). */
function renderExpandedBadge(p: BadgePlant, s: ConfidenceSite) {
  const confidence = plantConfidence(p, s)
  const view = render(<ConfidenceBadge confidence={confidence} plant={p} site={s} />)
  fireEvent.click(within(view.container).getByRole('button'))
  return { confidence, view }
}

describe('ConfidenceChip', () => {
  it('always carries the band as text, not colour alone', () => {
    render(<ConfidenceChip band="worth_checking" />)
    expect(screen.getByText('Worth checking')).toBeInTheDocument()
  })
})

describe('ConfidenceBadge', () => {
  it('shows High confidence with the matched factors when everything checks out', () => {
    renderExpandedBadge(plant(), site())
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText(/Checks out:.*sunlight.*your soil.*your winter zone/)).toBeInTheDocument()
  })

  it('a soil mismatch reads Worth checking, names the conflict and the fix — never death', () => {
    renderExpandedBadge(plant({ soil_compatibility: ['sand'], native: true }), site({ soil: 'clay' }))
    // Un-offsettable even for a native plant.
    expect(screen.getByText('Worth checking')).toBeInTheDocument()
    expect(screen.getByText(/clay soil.*soil preparation/)).toBeInTheDocument()
    // Reassurance that it passed the hard survival filters.
    expect(screen.getByText(/Passed our core survival checks/)).toBeInTheDocument()
  })

  it('points a soil mismatch at the care tips when the plant has care notes', () => {
    renderExpandedBadge(
      plant({ soil_compatibility: ['sand'], care_notes: 'Mix in grit.' }),
      site({ soil: 'clay' }),
    )
    expect(screen.getByText(/see the care tips below/)).toBeInTheDocument()
  })

  it('gives moisture conflicts direction-specific advice', () => {
    renderExpandedBadge(plant({ moisture: 'dry' }), site({ rainfallMm: 1200 }))
    expect(screen.getByText(/drier ground.*drainage/)).toBeInTheDocument()

    renderExpandedBadge(plant({ moisture: 'wet' }), site({ rainfallMm: 500 }))
    expect(screen.getByText(/more moisture.*water it in dry spells/)).toBeInTheDocument()
  })

  it('shows a native-offset gap honestly: High confidence, gap named, locally adapted named', () => {
    renderExpandedBadge(plant({ native: true }), site({ soil: null }))
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText(/couldn’t confirm your soil type/)).toBeInTheDocument()
    expect(screen.getByText(/locally adapted/)).toBeInTheDocument()
  })

  it('explains unverified AI traits and approximate location in plain words', () => {
    // maintenance: null so no boost offsets a gap — two gaps stay two gaps.
    renderExpandedBadge(
      plant({ ai_origin_fields: ['moisture'] }),
      site({ locationBasis: 'postcode_centroid', maintenance: null }),
    )
    expect(screen.getByText('Worth checking')).toBeInTheDocument()
    expect(screen.getByText(/awaiting expert verification/)).toBeInTheDocument()
    expect(screen.getByText(/postcode area/)).toBeInTheDocument()
  })
})

describe('PlanConfidenceHeadline', () => {
  function summaryOf(bands: ConfidenceBand[]) {
    const s = summarizePlanConfidence(bands)
    if (!s) throw new Error('expected a summary')
    return s
  }

  it('shows the majority band with an explicit exception count', () => {
    const bands: ConfidenceBand[] = [
      ...Array<ConfidenceBand>(9).fill('high'),
      'worth_checking',
      'worth_checking',
    ]
    render(<PlanConfidenceHeadline summary={summaryOf(bands)} site={site()} />)
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText(/9 of 11 plants.*2 worth checking/)).toBeInTheDocument()
  })

  it('names the checked evidence when the site data is complete', () => {
    render(<PlanConfidenceHeadline summary={summaryOf(['high', 'high'])} site={site()} />)
    expect(screen.getByText(/All 2 plants/)).toBeInTheDocument()
    expect(
      screen.getByText(/Checked against your sunlight, loam soil, winter zone 8 and local rainfall/),
    ).toBeInTheDocument()
  })

  it('attributes a site-wide gap to the site data, not the plants', () => {
    render(
      <PlanConfidenceHeadline
        summary={summaryOf(['good', 'good', 'good'])}
        site={site({ soil: null })}
      />,
    )
    expect(screen.getByText(/couldn’t confirm your soil type.*not in the plants/)).toBeInTheDocument()
  })
})

describe('the copy rules (spec: no percentages, no scores, no guarantee)', () => {
  it('never renders a percentage, numeric score, or guarantee wording', () => {
    // Exercise every reason code and band at once: a plant carrying both
    // mismatches, every gap, and offsets on a fully-gapped site.
    const worst = plant({
      soil_compatibility: ['sand'],
      moisture: 'dry',
      ai_origin_fields: ['moisture', 'native'],
      native: true,
      care_notes: 'notes',
    })
    const gappySite = site({ soil: 'clay', rainfallMm: 1200, locationBasis: 'postcode_centroid' })
    const offsetPlant = plant({ native: true })
    const offsetSite = site({ soil: null, zone: null })

    const { container } = render(
      <div>
        <ConfidenceBadge confidence={plantConfidence(worst, gappySite)} plant={worst} site={gappySite} />
        <ConfidenceBadge
          confidence={plantConfidence(offsetPlant, offsetSite)}
          plant={offsetPlant}
          site={offsetSite}
        />
        <ConfidenceBadge confidence={plantConfidence(plant(), site())} plant={plant()} site={site()} />
        <PlanConfidenceHeadline
          summary={summarizePlanConfidence(['high', 'good', 'worth_checking', 'worth_checking'])!}
          site={site({ soil: null, zone: null, locationBasis: 'postcode_centroid' })}
        />
      </div>,
    )
    for (const btn of screen.getAllByRole('button')) fireEvent.click(btn)

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/%/)
    expect(text).not.toMatch(/guarantee/i)
    expect(text).not.toMatch(/\bscore\b/i)
    // Bands are words, never "8/10"-style numerics.
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/)
  })

  it('keeps band labels free of promise words', () => {
    for (const band of ['high', 'good', 'worth_checking'] as const) {
      expect(bandLabel(band)).not.toMatch(/guarantee|%|\d/i)
    }
  })
})
