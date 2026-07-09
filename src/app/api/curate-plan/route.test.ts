import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Plant } from '@/lib/plants'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { getUser, tables } = vi.hoisted(() => ({
  getUser: vi.fn(),
  // Per-table results the chainable query mock resolves to.
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
    from: (table: string) => queryChain(table),
  })),
}))

/**
 * Minimal chainable+thenable query mock: supports the route's
 * `.select('*').eq(...).maybeSingle()` and the directly-awaited
 * `.select('*')` (catalogue), resolving to `tables[table]`.
 */
function queryChain(table: string) {
  const result = () => tables[table] ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => result()
  chain.then = (resolve: (v: unknown) => void) => resolve(result())
  return chain
}

// ─── Import route after mocks ────────────────────────────────────────────────

import { POST, callCurator } from './route'
import { CURATION_INTRO_MAX } from '@/lib/plan-curation'
import type { Scan, ScanEnrichment } from '@/lib/scans'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'bbbbbbbb-0000-4000-a000-000000000001'
const SCAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'
const WEBHOOK_URL = 'https://n8n.example/webhook/plan-curation'
const SECRET = 'test-secret'

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
    id: `cccccccc-0000-4000-a000-${seq}`,
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

/** 6 survivors — richnessForArea(20 m²) = 6, so bounds are 4–6 picks. */
function seedTables(plants: Plant[]) {
  tables['scans'] = { data: SCAN, error: null }
  tables['scan_enrichment'] = { data: ENRICHMENT, error: null }
  tables['plants'] = { data: plants, error: null }
  tables['users'] = { data: { maintenance_preference: 'low' }, error: null }
}

function okAnswer(plants: Plant[], count = 4) {
  return {
    status: 'ok',
    intro: 'Six sun-lovers that fill your loamy bed with almost no upkeep.',
    selection: plants.slice(0, count).map((p) => ({ plant_id: p.id, why: 'Low effort, suits loam.' })),
  }
}

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/curate-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function mockN8nJson(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  const spy = vi.fn().mockResolvedValue({ ok, status, json: async () => body })
  vi.stubGlobal('fetch', spy)
  return spy
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

describe('POST /api/curate-plan — HTTP layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(tables)) delete tables[key]
    process.env.N8N_CURATE_WEBHOOK_URL = WEBHOOK_URL
    process.env.N8N_CURATE_SECRET = SECRET
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(req({ scan_id: SCAN_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a non-JSON body and for a non-uuid scan_id', async () => {
    expect((await POST(req('nope', { raw: true }))).status).toBe(400)
    expect((await POST(req({ scan_id: 'not-a-uuid' }))).status).toBe(400)
  })

  it("returns 404 when the scan isn't found (RLS hides foreign scans)", async () => {
    tables['scans'] = { data: null, error: null }
    const res = await POST(req({ scan_id: SCAN_ID }))
    expect(res.status).toBe(404)
  })

  it('answers { curated: false } without calling n8n when env vars are missing', async () => {
    seedTables([plant(), plant(), plant(), plant(), plant(), plant()])
    delete process.env.N8N_CURATE_WEBHOOK_URL
    delete process.env.N8N_CURATE_SECRET
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ curated: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers { curated: false } without calling n8n when nothing survives the hard filters', async () => {
    seedTables([plant({ sun_tolerance: ['shade'] })]) // full-sun site → no survivors
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(req({ scan_id: SCAN_ID }))

    await expect(res.json()).resolves.toEqual({ curated: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the curated composition and sends n8n ONLY the survivor menu', async () => {
    const survivors = [plant(), plant(), plant(), plant(), plant(), plant()]
    const nonSurvivor = plant({ sun_tolerance: ['shade'] })
    seedTables([...survivors, nonSurvivor])
    const fetchSpy = mockN8nJson(okAnswer(survivors))

    const res = await POST(req({ scan_id: SCAN_ID }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.curated).toBe(true)
    expect(json.intro).toMatch(/sun-lovers/)
    expect(json.selection).toHaveLength(4)

    // The AI's menu: survivors only (the shade plant is never even mentioned),
    // with the secret header and the engine's bounds.
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect((init.headers as Record<string, string>)['x-sproutly-secret']).toBe(SECRET)
    const payload = JSON.parse(init.body as string)
    expect(payload.plants.map((p: { id: string }) => p.id)).toEqual(survivors.map((p) => p.id))
    expect(payload.bounds).toEqual({ min_picks: 4, max_picks: 6 })
    expect(payload.site).toMatchObject({ sun: 'full', area_sqm: 20, soil: 'loam', zone: 7 })
  })

  it('answers { curated: false } when the AI picks a plant outside the survivor menu', async () => {
    const survivors = [plant(), plant(), plant(), plant(), plant(), plant()]
    seedTables(survivors)
    const answer = okAnswer(survivors)
    answer.selection[0].plant_id = 'dddddddd-0000-4000-a000-000000000099' // hallucinated
    mockN8nJson(answer)

    const res = await POST(req({ scan_id: SCAN_ID }))

    await expect(res.json()).resolves.toEqual({ curated: false })
  })
})

// ─── Curator call ─────────────────────────────────────────────────────────────

describe('callCurator', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  const survivors = [plant(), plant(), plant(), plant(), plant(), plant()]
  const args = {
    webhookUrl: WEBHOOK_URL,
    secret: SECRET,
    scan: SCAN,
    enrichment: ENRICHMENT,
    maintenancePreference: 'low' as const,
    candidates: survivors,
  }

  it('returns the validated curation on a good answer', async () => {
    mockN8nJson(okAnswer(survivors))
    const result = await callCurator(args)
    expect(result).not.toBeNull()
    expect(result!.selection).toHaveLength(4)
  })

  it('returns null on an explicit no_curation answer', async () => {
    mockN8nJson({ status: 'no_curation', message: 'model refused' })
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null on a non-2xx response', async () => {
    mockN8nJson({}, { ok: false, status: 502 })
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null on an off-schema response', async () => {
    mockN8nJson({ status: 'ok', selection: 'everything' })
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null when the intro exceeds the length cap (never truncated)', async () => {
    const answer = okAnswer(survivors)
    answer.intro = 'a'.repeat(CURATION_INTRO_MAX + 1)
    mockN8nJson(answer)
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null when the pick count is outside the richness bounds', async () => {
    mockN8nJson(okAnswer(survivors, 2)) // bounds for 20 m² / 6 survivors are 4–6
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null when the same plant is picked twice', async () => {
    const answer = okAnswer(survivors)
    answer.selection[1].plant_id = answer.selection[0].plant_id
    mockN8nJson(answer)
    expect(await callCurator(args)).toBeNull()
  })

  it('returns null when the fetch throws (network error / timeout abort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
    expect(await callCurator(args)).toBeNull()
  })
})
