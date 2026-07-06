import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanConditions, ConditionChips } from './plan-conditions'
import type { Scan, ScanEnrichment } from '@/lib/scans'

/**
 * PROJ-7 — the compact conditions chip strip shown on the plan screen (ask:
 * "show the conditions there, smaller"). Asserts the observable chips: the
 * always-present scan conditions, the optional postcode chip, and the
 * environmental chips (soil / hardiness zone) that appear only once enrichment
 * has resolved them successfully.
 */

const scan = {
  sun_exposure: 'full',
  surface: 'lawn',
  space_type: 'garden',
  area_sqm: 25,
  postcode: '10115',
} as unknown as Scan

function enrichment(over: Partial<ScanEnrichment>): ScanEnrichment {
  return {
    soil_status: 'pending',
    soil_type: null,
    zone_status: 'pending',
    hardiness_zone: null,
    ...over,
  } as unknown as ScanEnrichment
}

describe('PlanConditions', () => {
  it('renders the scan conditions as chips, including the postcode', () => {
    render(<PlanConditions scan={scan} enrichment={null} />)
    expect(screen.getByText('Full sun')).toBeInTheDocument()
    expect(screen.getByText('25 m²')).toBeInTheDocument()
    expect(screen.getByText('10115')).toBeInTheDocument()
  })

  it('hides soil and zone chips until enrichment resolves', () => {
    render(<PlanConditions scan={scan} enrichment={enrichment({})} />)
    expect(screen.queryByText(/soil/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Zone /)).not.toBeInTheDocument()
  })

  it('shows soil and zone chips once enrichment succeeds', () => {
    render(
      <PlanConditions
        scan={scan}
        enrichment={enrichment({
          soil_status: 'success',
          soil_type: 'loam',
          zone_status: 'success',
          hardiness_zone: '7',
        })}
      />,
    )
    expect(screen.getByText('Loam soil')).toBeInTheDocument()
    expect(screen.getByText('Zone 7')).toBeInTheDocument()
  })

  it('omits the postcode chip when the scan has none', () => {
    render(<PlanConditions scan={{ ...scan, postcode: null } as unknown as Scan} enrichment={null} />)
    expect(screen.queryByText('10115')).not.toBeInTheDocument()
    expect(screen.getByText('Full sun')).toBeInTheDocument()
  })
})

describe('ConditionChips', () => {
  it('renders exactly the chips it is given', () => {
    render(<ConditionChips chips={[{ icon: null, label: 'Zone 7' }, { icon: null, label: 'Loam soil' }]} />)
    expect(screen.getByText('Zone 7')).toBeInTheDocument()
    expect(screen.getByText('Loam soil')).toBeInTheDocument()
  })
})
