import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * PROJ-13 — runtime verification of the confidence-band SNAPSHOT data layer
 * against the live schema with two real accounts:
 *   - the two new nullable columns (snapshot_rainfall_mm, snapshot_location_basis)
 *     round-trip for an owner and accept the pre-PROJ-13 NULL shape (no backfill);
 *   - the migration's check constraints hold (rainfall bounds, location enum) —
 *     a poisoned write can never persist a value the band module would misread;
 *   - owner-only RLS covers the new columns: user B can neither read them nor
 *     update them to skew user A's bands ("band poisoning").
 *
 * Bands themselves are computed, never persisted — the band/copy logic is proven
 * by the unit layer (plan-confidence.test.ts, plan-confidence-view.test.tsx,
 * plan-engine.test.ts). Runs in the browser-less `rls` project; skips cleanly
 * without the Supabase env. Ephemeral users, purged in afterAll.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ready = Boolean(url && anonKey && serviceKey)

const EMAIL_PREFIX = 'proj13.conf.'
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

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

function newPlan(scanId: string, userId: string, over: Record<string, unknown> = {}) {
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
    ...over,
  }
}

test.describe('PROJ-13 confidence snapshot columns — round-trip, constraints, RLS (two real accounts)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!ready, 'Set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local to run')

  let admin: SupabaseClient
  let owner: SeededUser
  let other: SeededUser
  let scanA: string
  let scanB: string
  let planId: string

  async function purgeUsers() {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
    const stale = (data?.users ?? []).filter((u) => u.email?.startsWith(EMAIL_PREFIX))
    for (const u of stale) await admin.auth.admin.deleteUser(u.id)
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
    owner = await seed('owner')
    other = await seed('other')

    const sA = newScan(owner.id)
    const sB = newScan(owner.id)
    scanA = sA.id
    scanB = sB.id
    const { error: sErr } = await owner.client.from('scans').insert([sA, sB])
    if (sErr) throw sErr
  })

  test.afterAll(async () => {
    if (!ready) return
    await purgeUsers() // cascades scans → plans
  })

  test('owner can insert a plan carrying the new snapshot columns, and they round-trip', async () => {
    const plan = newPlan(scanA, owner.id, {
      snapshot_rainfall_mm: 640,
      snapshot_location_basis: 'postcode_centroid',
    })
    planId = plan.id as string
    const { error } = await owner.client.from('plans').insert(plan)
    expect(error).toBeNull()

    const { data } = await owner.client
      .from('plans')
      .select('snapshot_rainfall_mm, snapshot_location_basis')
      .eq('id', planId)
      .single()
    expect(data?.snapshot_rainfall_mm).toBe(640)
    expect(data?.snapshot_location_basis).toBe('postcode_centroid')
  })

  test('the pre-PROJ-13 NULL shape is accepted (nullable columns, no backfill required)', async () => {
    const plan = newPlan(scanB, owner.id) // neither new column supplied
    const { error } = await owner.client.from('plans').insert(plan)
    expect(error).toBeNull()
    const { data } = await owner.client
      .from('plans')
      .select('snapshot_rainfall_mm, snapshot_location_basis')
      .eq('id', plan.id as string)
      .single()
    expect(data?.snapshot_rainfall_mm).toBeNull()
    expect(data?.snapshot_location_basis).toBeNull()
  })

  test('check constraint: negative rainfall is rejected', async () => {
    const { error } = await owner.client
      .from('plans')
      .update({ snapshot_rainfall_mm: -1 })
      .eq('id', planId)
    expect(error).not.toBeNull()
  })

  test('check constraint: absurd rainfall (20000 mm) is rejected', async () => {
    const { error } = await owner.client
      .from('plans')
      .update({ snapshot_rainfall_mm: 20000 })
      .eq('id', planId)
    expect(error).not.toBeNull()
  })

  test('check constraint: an unknown location basis is rejected', async () => {
    const { error } = await owner.client
      .from('plans')
      .update({ snapshot_location_basis: 'satellite' })
      .eq('id', planId)
    expect(error).not.toBeNull()
  })

  test('AC-security: user B cannot read user A’s plan (new columns do not leak)', async () => {
    const { data } = await other.client
      .from('plans')
      .select('snapshot_rainfall_mm, snapshot_location_basis')
      .eq('id', planId)
    expect(data ?? []).toEqual([])
  })

  test('AC-security: user B cannot skew user A’s bands by updating the snapshot', async () => {
    await other.client.from('plans').update({ snapshot_rainfall_mm: 9999 }).eq('id', planId)
    // Read back as the owner — the value must be untouched.
    const { data } = await owner.client
      .from('plans')
      .select('snapshot_rainfall_mm')
      .eq('id', planId)
      .single()
    expect(data?.snapshot_rainfall_mm).toBe(640)
  })
})
