import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlantForm } from './plant-form'
import type { Plant } from '@/lib/plants'
import { savePlant } from '@/lib/plants-client'

/**
 * PROJ-14 — the admin-form "side door" for ecological traits: the manual path
 * for rows the ETL pipeline deliberately won't touch (hand-seeded plants).
 * Asserts the observable contract: not-assessed selects persist as NULL (never
 * a guessed value), assessed values round-trip, the AI-inferred provenance chip
 * shows only for traits listed in eco_ai_origin_fields, and a half-set bloom
 * pair blocks the save with a field-level error.
 */

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/plants-client', () => ({
  savePlant: vi.fn(async () => {}),
  isUniqueViolation: () => false,
}))

const savePlantMock = vi.mocked(savePlant)

function plant(over: Partial<Plant> = {}): Plant {
  return {
    id: 'plant-1',
    common_name: 'Echter Lavendel',
    latin_name: 'Lavandula angustifolia',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 6,
    mature_height_cm: 60,
    mature_spread_cm: 60,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: false,
    image_url: null,
    care_notes: null,
    created_at: '2026-06-20T00:00:00Z',
    updated_at: null,
    ...over,
  }
}

beforeAll(() => {
  // jsdom gap for Radix Select (same stub as plan-editor.test.tsx).
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  savePlantMock.mockClear()
})

describe('PlantForm — ecological traits (PROJ-14)', () => {
  it('renders the ecological section with every trait defaulting to "Not assessed"', () => {
    render(<PlantForm plant={null} />)
    expect(screen.getByText('Ecological traits')).toBeInTheDocument()
    // All five controls exist and sit on the honest default.
    for (const id of ['insect_value', 'bird_value', 'pollinator_friendly', 'bloom_start_month', 'bloom_end_month']) {
      const trigger = document.getElementById(id)!
      expect(trigger).toBeInTheDocument()
      expect(trigger.textContent).toMatch(/not assessed/i)
    }
  })

  it('saves untouched ecological traits as NULL (not assessed), never a guessed value', async () => {
    render(<PlantForm plant={plant()} />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(savePlantMock).toHaveBeenCalledTimes(1))
    const { values } = savePlantMock.mock.calls[0][1]
    expect(values.insect_value).toBeNull()
    expect(values.bird_value).toBeNull()
    expect(values.bloom_start_month).toBeNull()
    expect(values.bloom_end_month).toBeNull()
    expect(values.pollinator_friendly).toBeNull()
  })

  it('round-trips assessed values, including a year-wrapping bloom period and an explicit "none"', async () => {
    render(
      <PlantForm
        plant={plant({
          insect_value: 'high',
          bird_value: 'none',
          bloom_start_month: 11,
          bloom_end_month: 2,
          pollinator_friendly: true,
        })}
      />,
    )
    // The prefilled selects display the stored values…
    expect(document.getElementById('insect_value')!.textContent).toBe('High')
    expect(document.getElementById('bird_value')!.textContent).toBe('None')
    expect(document.getElementById('bloom_start_month')!.textContent).toBe('November')
    expect(document.getElementById('bloom_end_month')!.textContent).toBe('February')
    expect(document.getElementById('pollinator_friendly')!.textContent).toBe('Yes')

    // …and the wrap (end before start) saves without a validation error.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(savePlantMock).toHaveBeenCalledTimes(1))
    const { values } = savePlantMock.mock.calls[0][1]
    expect(values).toMatchObject({
      insect_value: 'high',
      bird_value: 'none',
      bloom_start_month: 11,
      bloom_end_month: 2,
      pollinator_friendly: true,
    })
  })

  it('marks only the traits listed in eco_ai_origin_fields as AI-inferred', () => {
    render(
      <PlantForm
        plant={plant({
          insect_value: 'medium',
          bird_value: 'low',
          eco_ai_origin_fields: ['insect_value', 'bloom_period'],
        })}
      />,
    )
    const chips = screen.getAllByText(/AI-inferred — not yet verified/i)
    expect(chips).toHaveLength(2) // insect_value + the bloom pair; bird_value is verified
  })

  it('blocks saving a half-set bloom pair with a field-level error', async () => {
    render(<PlantForm plant={plant({ bloom_start_month: 5, bloom_end_month: null })} />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/set both bloom months/i)).toBeInTheDocument()
    expect(savePlantMock).not.toHaveBeenCalled()
  })
})
