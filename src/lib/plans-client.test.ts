import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  persistGeneratedPlan,
  replacePlanLines,
  requestCuration,
  type PlanLineInput,
} from './plans-client'
import type { Plant } from './plants'
import type { Scan, ScanEnrichment } from './scans'

const PLAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'

const LINES: PlanLineInput[] = [
  { plantId: 'plant-1', quantity: 3, soilFlag: false, pinned: true, rationale: 'Loves your loam.' },
  { plantId: 'plant-2', quantity: 8, soilFlag: true, pinned: false, rationale: null },
]

type Client = Parameters<typeof replacePlanLines>[0]

function mockClient() {
  const calls: string[] = []
  const insert = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => {
    calls.push('insert')
    return { error: null }
  })
  const deleteNot = vi.fn(async (..._args: unknown[]) => {
    calls.push('delete')
    return { error: null }
  })
  // .delete().eq(...) is awaited directly for the empty case and chained with
  // .not(...) for the prune — the object is both thenable and chainable.
  const eqResult = {
    not: deleteNot,
    then: (resolve: (v: { error: null }) => void) => {
      calls.push('delete')
      resolve({ error: null })
    },
  }
  const deleteEq = vi.fn(() => eqResult)
  const del = vi.fn(() => ({ eq: deleteEq }))
  const client = { from: vi.fn(() => ({ insert, delete: del })) } as unknown as Client
  return { client, calls, insert, del, deleteEq, deleteNot }
}

describe('replacePlanLines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('INSERTS the new rows before pruning the old ones (a failure can never empty the plan)', async () => {
    const { client, calls, insert, deleteNot } = mockClient()

    await replacePlanLines(client, PLAN_ID, LINES)

    expect(calls).toEqual(['insert', 'delete'])

    // Rows carry client-side ids, array-index sort order, and the line's rationale
    // (PROJ-12: an edit must never wipe a curated plan's "why" lines).
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      plan_id: PLAN_ID,
      plant_id: 'plant-1',
      quantity: 3,
      sort_order: 0,
      soil_flag: false,
      pinned: true,
      rationale: 'Loves your loam.',
    })
    expect(rows[1]).toMatchObject({ plant_id: 'plant-2', sort_order: 1, rationale: null })
    expect(typeof rows[0].id).toBe('string')

    // The prune excludes exactly the freshly inserted ids.
    const [column, op, list] = deleteNot.mock.calls[0] as [string, string, string]
    expect(column).toBe('id')
    expect(op).toBe('in')
    expect(list).toBe(`(${rows.map((r) => r.id).join(',')})`)
  })

  it('does not prune anything when the insert fails (old lines survive)', async () => {
    const { client, insert, deleteNot } = mockClient()
    insert.mockResolvedValue({ error: { message: 'insert failed' } })

    await expect(replacePlanLines(client, PLAN_ID, LINES)).rejects.toMatchObject({
      message: 'insert failed',
    })
    expect(deleteNot).not.toHaveBeenCalled()
  })

  it('deletes all lines when the new set is empty (explicit removal of every plant)', async () => {
    const { client, calls, insert, deleteEq } = mockClient()

    await replacePlanLines(client, PLAN_ID, [])

    expect(insert).not.toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('plan_id', PLAN_ID)
    expect(calls).toEqual(['delete'])
  })
})

// ─── PROJ-12: curation on the generate path ───────────────────────────────────

const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'
const SCAN_ID = 'cccccccc-0000-4000-a000-000000000001'

const SCAN = {
  id: SCAN_ID,
  short_code: 'Kp3xR9aQ',
  user_id: USER_ID,
  sun_exposure: 'full',
  surface: 'soil',
  space_type: 'back_garden',
  area_sqm: 20,
} as Scan

const ENRICHMENT = {
  scan_id: SCAN_ID,
  soil_type: 'loam',
  soil_status: 'success',
  hardiness_zone: '7',
  zone_status: 'success',
} as ScanEnrichment

let plantSeq = 0
function plant(overrides: Partial<Plant> = {}): Plant {
  plantSeq += 1
  const seq = String(plantSeq).padStart(12, '0')
  return {
    id: `dddddddd-0000-4000-a000-${seq}`,
    common_name: `Plant ${plantSeq}`,
    latin_name: `Plantus ${plantSeq}`,
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 5,
    mature_height_cm: 40,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    image_url: null,
    care_notes: null,
    created_at: '2026-01-01',
    updated_at: null,
    ...overrides,
  }
}

/**
 * Supabase mock for persistGeneratedPlan: catalogue read (thenable select),
 * profile read (select.eq.maybeSingle), plan delete + inserts (plans, plan_plants).
 */
function mockGenClient(catalogue: Plant[]) {
  const inserted: Record<string, unknown[]> = { plans: [], plan_plants: [] }
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: { maintenance_preference: 'low' }, error: null })
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: catalogue, error: null })
    chain.delete = () => ({ eq: async () => ({ error: null }) })
    chain.insert = async (rows: unknown) => {
      inserted[table]?.push(...(Array.isArray(rows) ? rows : [rows]))
      return { error: null }
    }
    return chain
  })
  return { client: { from } as unknown as Client, inserted }
}

function mockCurateFetch(body: unknown, { ok = true }: { ok?: boolean } = {}) {
  const spy = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('requestCuration', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('returns the curation when the route answers curated: true', async () => {
    const p = plant()
    mockCurateFetch({ curated: true, intro: 'A fine mix.', selection: [{ plant_id: p.id, why: 'Fits.' }] })
    const result = await requestCuration(SCAN_ID)
    expect(result).toEqual({ intro: 'A fine mix.', selection: [{ plant_id: p.id, why: 'Fits.' }] })
  })

  it('returns null on curated: false, non-2xx, off-schema, and network error — never throws', async () => {
    mockCurateFetch({ curated: false })
    expect(await requestCuration(SCAN_ID)).toBeNull()

    mockCurateFetch({}, { ok: false })
    expect(await requestCuration(SCAN_ID)).toBeNull()

    mockCurateFetch({ curated: true, intro: '', selection: [] })
    expect(await requestCuration(SCAN_ID)).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await requestCuration(SCAN_ID)).toBeNull()
  })
})

describe('persistGeneratedPlan — curation integration', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('persists the curated composition + rationale when the AI answer is valid', async () => {
    const catalogue = [plant(), plant(), plant(), plant(), plant(), plant()]
    const picked = catalogue.slice(0, 4)
    const { client, inserted } = mockGenClient(catalogue)
    mockCurateFetch({
      curated: true,
      intro: 'Four easy natives for your sunny loam.',
      selection: picked.map((p) => ({ plant_id: p.id, why: 'Easy in your conditions.' })),
    })

    await persistGeneratedPlan(client, { scan: SCAN, enrichment: ENRICHMENT, userId: USER_ID })

    const [planRow] = inserted.plans as Array<Record<string, unknown>>
    expect(planRow.rationale_intro).toBe('Four easy natives for your sunny loam.')
    const lines = inserted.plan_plants as Array<Record<string, unknown>>
    expect(lines).toHaveLength(4)
    expect(lines.map((l) => l.plant_id).sort()).toEqual(picked.map((p) => p.id).sort())
    for (const line of lines) expect(line.rationale).toBe('Easy in your conditions.')
  })

  it('falls back to the pure rule-engine plan (rationale NULL) when curation fails', async () => {
    const catalogue = [plant(), plant(), plant(), plant(), plant(), plant()]
    const { client, inserted } = mockGenClient(catalogue)
    mockCurateFetch({ curated: false })

    await persistGeneratedPlan(client, { scan: SCAN, enrichment: ENRICHMENT, userId: USER_ID })

    const [planRow] = inserted.plans as Array<Record<string, unknown>>
    expect(planRow.rationale_intro).toBeNull()
    const lines = inserted.plan_plants as Array<Record<string, unknown>>
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line.rationale).toBeNull()
  })

  it('rejects an invalid AI selection client-side (hallucinated id) → rule plan persists', async () => {
    const catalogue = [plant(), plant(), plant(), plant(), plant(), plant()]
    const { client, inserted } = mockGenClient(catalogue)
    mockCurateFetch({
      curated: true,
      intro: 'Sounds nice but is wrong.',
      selection: [
        { plant_id: 'eeeeeeee-0000-4000-a000-000000000099', why: 'I made this one up.' },
        ...catalogue.slice(0, 3).map((p) => ({ plant_id: p.id, why: 'Fine.' })),
      ],
    })

    await persistGeneratedPlan(client, { scan: SCAN, enrichment: ENRICHMENT, userId: USER_ID })

    const [planRow] = inserted.plans as Array<Record<string, unknown>>
    expect(planRow.rationale_intro).toBeNull()
    for (const line of inserted.plan_plants as Array<Record<string, unknown>>) {
      expect(line.rationale).toBeNull()
    }
  })

  it('never calls the curation route when the rule plan is empty (nothing to curate)', async () => {
    const { client, inserted } = mockGenClient([]) // empty catalogue → empty plan
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await persistGeneratedPlan(client, { scan: SCAN, enrichment: ENRICHMENT, userId: USER_ID })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(inserted.plans).toHaveLength(1)
    expect(inserted.plan_plants).toHaveLength(0)
  })
})
