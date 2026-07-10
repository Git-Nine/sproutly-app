import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlanEditor } from './plan-editor'
import type { Plant } from '@/lib/plants'
import type { Scan, ScanEnrichment } from '@/lib/scans'
import type { Plan, PlanPlantWithPlant } from '@/lib/plans'

/**
 * PROJ-13 QA — integration of the confidence band into the plan editor: the
 * headline, the per-plant badges, and the picker chips must all render from the
 * SAME pure-module output and recompute together when the plan changes. This is
 * the wiring the component tests (plan-confidence-view.test.tsx) and module
 * tests (plan-confidence.test.ts) don't cover.
 */

vi.mock('@/lib/plans-client', () => ({ replacePlanLines: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

beforeAll(() => {
  // jsdom gaps for Radix Popover + cmdk (the add-plant picker).
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let seq = 0
function plant(over: Partial<Plant> = {}): Plant {
  seq += 1
  return {
    id: `plant-${seq}`,
    common_name: `Plant ${seq}`,
    latin_name: `Plantus ${seq}`,
    sun_tolerance: ['full'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 6,
    mature_height_cm: 50,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: false,
    image_url: null,
    care_notes: null,
    moisture: null,
    ai_origin_fields: [],
    created_at: '2026-01-01',
    updated_at: null,
    ...over,
  }
}

const plan = {
  id: 'plan-1',
  scan_id: 'scan-1',
  user_id: 'user-1',
  snapshot_sun: 'full',
  snapshot_area_sqm: 30,
  snapshot_surface: 'soil',
  snapshot_space_type: 'back_garden',
  snapshot_soil: 'loam',
  snapshot_zone: 7,
  snapshot_maintenance: null,
  snapshot_rainfall_mm: 800,
  snapshot_location_basis: 'gps',
  zone_unconfirmed: false,
  extra_match_count: 0,
  rationale_intro: null,
  created_at: '2026-01-01',
  updated_at: null,
} as Plan

const scan = { id: 'scan-1', short_code: 'Kp3xR9aQ' } as Scan

function line(p: Plant): PlanPlantWithPlant {
  return {
    id: `line-${p.id}`,
    plan_id: plan.id,
    plant_id: p.id,
    quantity: 3,
    sort_order: 0,
    soil_flag: false,
    pinned: false,
    rationale: null,
    created_at: '2026-01-01',
    plants: p,
  }
}

function renderEditor(linePlants: Plant[], survivors: Plant[] = []) {
  return render(
    <PlanEditor
      plan={plan}
      initialLines={linePlants.map(line)}
      allSurvivors={[...linePlants, ...survivors]}
      scan={scan}
      enrichment={null as ScanEnrichment | null}
      userId="user-1"
      isStale={false}
    />,
  )
}

describe('PlanEditor — PROJ-13 confidence integration', () => {
  it('renders the headline and one band chip per plant, from the same module output', () => {
    const clean = plant() // loam-compatible on a loam site → high
    const mismatched = plant({ soil_compatibility: ['sand'] }) // soil mismatch → worth checking
    renderEditor([clean, mismatched])

    expect(screen.getByText('Survival confidence')).toBeInTheDocument()
    // Headline: 1 high vs 1 worth_checking is a TIE → lower band wins (never oversell).
    expect(screen.getAllByText('Worth checking').length).toBeGreaterThanOrEqual(2) // headline + line chip
    expect(screen.getByText(/1 of 2 plants/)).toBeInTheDocument()
    expect(screen.getByText(/1 high confidence/)).toBeInTheDocument()
    expect(screen.getByText('High confidence')).toBeInTheDocument() // the clean plant's chip
  })

  it('recomputes the headline immediately when a plant is removed', async () => {
    const clean = plant()
    const mismatched = plant({ common_name: 'Sandwort', soil_compatibility: ['sand'] })
    renderEditor([clean, mismatched])

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sandwort' }))

    // Only the clean plant remains → uniform high-confidence headline.
    expect(await screen.findByText(/All 1 plants|Your plant/)).toBeInTheDocument()
    expect(screen.queryByText('Worth checking')).not.toBeInTheDocument()
  })

  it('shows a band chip on every add-picker candidate', () => {
    const inPlan = plant()
    const candidateHigh = plant({ common_name: 'Candidate High' })
    const candidateRisky = plant({ common_name: 'Candidate Risky', soil_compatibility: ['sand'] })
    renderEditor([inPlan], [candidateHigh, candidateRisky])

    fireEvent.click(screen.getByRole('button', { name: /Add more plants/ }))

    const listbox = screen.getByRole('listbox')
    const rows = within(listbox).getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(within(listbox).getByText('Candidate High').closest('[role="option"]')).toHaveTextContent(
      'High confidence',
    )
    expect(within(listbox).getByText('Candidate Risky').closest('[role="option"]')).toHaveTextContent(
      'Worth checking',
    )
  })

  it('a plan with lines carries the zone gap in the headline, not the legacy banner', () => {
    const zonelessPlan = { ...plan, snapshot_zone: null, zone_unconfirmed: true }
    render(
      <PlanEditor
        plan={zonelessPlan}
        initialLines={[line(plant())]}
        allSurvivors={[]}
        scan={scan}
        enrichment={null}
        userId="user-1"
        isStale={false}
      />,
    )
    expect(screen.getByText(/couldn’t confirm your winter-hardiness zone/)).toBeInTheDocument()
    // The pre-PROJ-13 banner (with its "guaranteed" wording) must not double up.
    expect(screen.queryByText(/winter survival isn’t guaranteed/)).not.toBeInTheDocument()
  })
})
