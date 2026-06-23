import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * PROJ-8 — runtime verification of the shopping-list SECURITY ACs against two real
 * accounts. The shopping-list page is read-only and live-derived; it performs the
 * exact read chain this suite exercises:
 *   scans (by id) → plans (by scan_id) → plan_plants joined with plants.
 *
 * Proves:
 *   - the owner reads their own scan + plan + plan lines (the list has data to show);
 *   - a non-owner reading the same ids gets nothing back from every step
 *     (scan, plan, and plan_plants), so the page would notFound()/redirect and never
 *     render another user's list — the owner-only AC.
 *
 * Runs in the browser-less `rls` project. Skips cleanly without the Supabase env.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ready = Boolean(url && anonKey && serviceKey)

const EMAIL_PREFIX = 'proj8.shop.'
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const LATIN = (n: number) => `ZZ-QA8-${stamp}-${n}`

type SeededUser = { id: string; client: SupabaseClient }

function newScan(userId: string) {
  const id = randomUUID()
  return {
    id,
    user_id: userId,
    photo_path: `${userId}/scans/${id}/photo`,
    postcode: '09123',
    sun_exposure: 'full',
    surface: 'soil',
    space_type: 'back_garden',
    area_sqm: 30,
  }
}
function newPlan(scanId: string, userId: string) {
  return {
    id: randomUUID(),
    scan_id: scanId,
    user_id: userId,
    snapshot_sun: 'full',
    snapshot_area_sqm: 30,
    snapshot_surface: 'soil',
    snapshot_space_type: 'back_garden',
    snapshot_soil: 'loam',
    snapshot_zone: 7,
    snapshot_maintenance: null,
    zone_unconfirmed: false,
    extra_match_count: 0,
  }
}
function newPlant(latin: string) {
  return {
    common_name: 'QA8 Testpflanze',
    latin_name: latin,
    sun_tolerance: ['full'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 6,
    mature_height_cm: 50,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: false,
  }
}

test.describe('PROJ-8 shopping list — owner-only live-derived reads (two real accounts)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!ready, 'Set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local to run')

  let admin: SupabaseClient
  let owner: SeededUser
  let other: SeededUser
  let scanId: string
  let planId: string
  let plantA: string

  async function purgeUsers() {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
    const stale = (data?.users ?? []).filter((u) => u.email?.startsWith(EMAIL_PREFIX))
    for (const u of stale) await admin.auth.admin.deleteUser(u.id)
  }
  async function purgePlants() {
    await admin.from('plants').delete().like('latin_name', 'ZZ-QA8-%')
  }
  async function seed(label: string): Promise<SeededUser> {
    const email = `${EMAIL_PREFIX}${stamp}.${label}@example.com`
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (cErr || !created.user) throw cErr ?? new Error('createUser failed')
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (lErr) throw lErr
    const otp = link.properties?.email_otp
    if (!otp) throw new Error('no otp')
    const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: v, error: vErr } = await client.auth.verifyOtp({ email, token: otp, type: 'email' })
    if (vErr || !v.session) throw vErr ?? new Error('verifyOtp failed')
    return { id: created.user.id, client }
  }

  test.beforeAll(async () => {
    if (!ready) return
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    await purgeUsers()
    await purgePlants()
    owner = await seed('owner')
    other = await seed('other')

    const { data: plants, error: pErr } = await admin
      .from('plants')
      .insert([newPlant(LATIN(1))])
      .select('id, latin_name')
    if (pErr || !plants) throw pErr ?? new Error('plant seed failed')
    plantA = plants[0].id

    const scan = newScan(owner.id)
    scanId = scan.id
    const { error: sErr } = await owner.client.from('scans').insert(scan)
    if (sErr) throw sErr
    const plan = newPlan(scanId, owner.id)
    planId = plan.id
    const { error: plErr } = await owner.client.from('plans').insert(plan)
    if (plErr) throw plErr
    const { error: lErr } = await owner.client.from('plan_plants').insert({
      plan_id: planId,
      plant_id: plantA,
      quantity: 3,
      sort_order: 0,
      soil_flag: true,
      pinned: false,
    })
    if (lErr) throw lErr
  })

  test.afterAll(async () => {
    if (!ready) return
    await purgeUsers() // cascades scans → plans → plan_plants
    await purgePlants()
  })

  test('owner reads their own scan (page step 1)', async () => {
    const { data } = await owner.client.from('scans').select('*').eq('id', scanId).maybeSingle()
    expect(data?.id).toBe(scanId)
  })

  test('owner reads their plan and its flagged line (the list has data)', async () => {
    const { data: plan } = await owner.client.from('plans').select('*').eq('scan_id', scanId).maybeSingle()
    expect(plan?.id).toBe(planId)

    const { data: lines } = await owner.client
      .from('plan_plants')
      .select('*, plants(*)')
      .eq('plan_id', planId)
      .order('sort_order')
    expect(lines).toHaveLength(1)
    expect(lines?.[0]?.quantity).toBe(3)
    expect(lines?.[0]?.soil_flag).toBe(true)
    // The join carries the plant the deep link is built from.
    expect((lines?.[0] as { plants?: { latin_name?: string } })?.plants?.latin_name).toBe(LATIN(1))
  })

  test('AC-security: a non-owner cannot read the owner’s scan', async () => {
    const { data } = await other.client.from('scans').select('*').eq('id', scanId).maybeSingle()
    expect(data).toBeNull() // → notFound() on the page
  })

  test('AC-security: a non-owner cannot read the owner’s plan', async () => {
    const { data } = await other.client.from('plans').select('*').eq('scan_id', scanId).maybeSingle()
    expect(data).toBeNull()
  })

  test('AC-security: a non-owner cannot read the owner’s plan lines (no list data leaks)', async () => {
    const { data } = await other.client.from('plan_plants').select('*, plants(*)').eq('plan_id', planId)
    expect(data ?? []).toEqual([])
  })
})
