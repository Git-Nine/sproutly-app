import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * PROJ-6 — runtime verification of the plan security ACs + the delete-reassignment
 * contract against two real accounts (an ADMIN and a regular USER). Mirrors the
 * PROJ-3/5 RLS harnesses. Proves end-to-end:
 *   - a user can create their OWN plan (plans + plan_plants);
 *   - owner-only RLS: user B can't read/insert/update/delete user A's plan or lines,
 *     and can't create a plan against A's scan (the through-join / with_check);
 *   - the RESTRICT FK blocks a plain delete of a plant that a plan references;
 *   - reassign_and_delete_plant (admin-only) re-points plan_plants to the
 *     replacement then hard-deletes the plant — no plan orphaned;
 *   - a non-admin cannot call the reassignment RPC; self-replacement is rejected.
 *
 * Runs in the browser-less `rls` project. Skips cleanly without the Supabase env.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ready = Boolean(url && anonKey && serviceKey)

const EMAIL_PREFIX = 'proj6.plans.'
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const LATIN = (n: number) => `ZZ-QA6-${stamp}-${n}`

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
    extra_match_count: 2,
  }
}

function newPlant(latin: string) {
  return {
    common_name: 'QA6 Testpflanze',
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

test.describe('PROJ-6 plans — owner-only RLS + admin reassignment (two real accounts)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!ready, 'Set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local to run')

  let admin: SupabaseClient
  let adminUser: SeededUser // also used as the catalogue admin + RPC caller
  let regularUser: SeededUser

  // Shared fixtures created in setup.
  let aScanId: string
  let aPlanId: string
  let targetPlantId: string
  let replacementPlantId: string

  async function purgeUsers() {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
    const stale = (data?.users ?? []).filter((u) => u.email?.startsWith(EMAIL_PREFIX))
    for (const u of stale) await admin.auth.admin.deleteUser(u.id)
  }
  async function purgePlants() {
    // Broad sweep (any run's stamp) so a leftover from a prior run also gets cleaned.
    await admin.from('plants').delete().like('latin_name', 'ZZ-QA6-%')
  }

  async function seed(label: string): Promise<SeededUser> {
    const email = `${EMAIL_PREFIX}${stamp}.${label}@example.com`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (createErr || !created.user) throw createErr ?? new Error('createUser returned no user')
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkErr) throw linkErr
    const otp = link.properties?.email_otp
    if (!otp) throw new Error('generateLink returned no email_otp')
    const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verified, error: otpErr } = await client.auth.verifyOtp({ email, token: otp, type: 'email' })
    if (otpErr || !verified.session) throw otpErr ?? new Error('verifyOtp returned no session')
    return { id: created.user.id, client }
  }

  test.beforeAll(async () => {
    if (!ready) return
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    await purgeUsers()
    await purgePlants()
    adminUser = await seed('admin')
    regularUser = await seed('user')
    const { error: roleErr } = await admin.from('users').update({ role: 'admin' }).eq('id', adminUser.id)
    if (roleErr) throw roleErr

    // Two catalogue plants (via the service client; bypasses RLS) for the reassignment test.
    const { data: plants, error: plantErr } = await admin
      .from('plants')
      .insert([newPlant(LATIN(1)), newPlant(LATIN(2))])
      .select('id, latin_name')
    if (plantErr || !plants) throw plantErr ?? new Error('plant seed failed')
    targetPlantId = plants.find((p) => p.latin_name === LATIN(1))!.id
    replacementPlantId = plants.find((p) => p.latin_name === LATIN(2))!.id
  })

  test.afterAll(async () => {
    if (!ready) return
    // Order matters: purge users FIRST so the cascade (scans → plans → plan_plants)
    // clears the references, otherwise the RESTRICT FK on plan_plants.plant_id blocks
    // deleting the replacement plant and it leaks into the catalogue.
    await purgeUsers()
    await purgePlants()
  })

  test('admin promotion took effect', async () => {
    const { data } = await admin.from('users').select('role').eq('id', adminUser.id).single()
    expect(data?.role).toBe('admin')
  })

  test('AC: a user can create their own scan, plan and plan lines', async () => {
    const scan = newScan(adminUser.id)
    aScanId = scan.id
    const { error: scanErr } = await adminUser.client.from('scans').insert(scan)
    expect(scanErr).toBeNull()

    const plan = newPlan(aScanId, adminUser.id)
    aPlanId = plan.id
    const { error: planErr } = await adminUser.client.from('plans').insert(plan)
    expect(planErr).toBeNull()

    const { error: lineErr } = await adminUser.client.from('plan_plants').insert([
      { plan_id: aPlanId, plant_id: targetPlantId, quantity: 5, sort_order: 0, soil_flag: false },
      { plan_id: aPlanId, plant_id: replacementPlantId, quantity: 3, sort_order: 1, soil_flag: true },
    ])
    expect(lineErr).toBeNull()

    const { data } = await adminUser.client.from('plan_plants').select('id').eq('plan_id', aPlanId)
    expect(data?.length).toBe(2)
  })

  test('AC-security: user B cannot read user A’s plan', async () => {
    const { data } = await regularUser.client.from('plans').select('id').eq('id', aPlanId)
    expect(data ?? []).toEqual([])
  })

  test('AC-security: user B cannot read user A’s plan lines (joined through plans)', async () => {
    const { data } = await regularUser.client.from('plan_plants').select('id').eq('plan_id', aPlanId)
    expect(data ?? []).toEqual([])
  })

  test('AC-security: user B cannot create a plan against user A’s scan', async () => {
    // user_id = B but scan belongs to A → with_check (scan ownership) must reject.
    const { error } = await regularUser.client.from('plans').insert(newPlan(aScanId, regularUser.id))
    expect(error).not.toBeNull()
    // And nothing landed for A's scan beyond A's own plan.
    const { data } = await admin.from('plans').select('user_id').eq('scan_id', aScanId)
    expect(data?.map((r) => r.user_id)).toEqual([adminUser.id])
  })

  test('AC-security: user B cannot insert plan lines into user A’s plan', async () => {
    const { error } = await regularUser.client
      .from('plan_plants')
      .insert({ plan_id: aPlanId, plant_id: targetPlantId, quantity: 1, sort_order: 9, soil_flag: false })
    expect(error).not.toBeNull()
    const { data } = await adminUser.client.from('plan_plants').select('id').eq('plan_id', aPlanId)
    expect(data?.length).toBe(2) // unchanged
  })

  test('AC-security: user B cannot update or delete user A’s plan', async () => {
    await regularUser.client.from('plans').update({ extra_match_count: 999 }).eq('id', aPlanId)
    await regularUser.client.from('plans').delete().eq('id', aPlanId)
    const { data } = await admin.from('plans').select('extra_match_count').eq('id', aPlanId).single()
    expect(data?.extra_match_count).toBe(2) // untouched, still present
  })

  test('AC: the RESTRICT FK blocks a plain delete of a plant a plan references', async () => {
    const { error } = await adminUser.client.from('plants').delete().eq('id', targetPlantId)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503') // foreign_key_violation
  })

  test('AC-security: a non-admin cannot call reassign_and_delete_plant', async () => {
    const { error } = await regularUser.client.rpc('reassign_and_delete_plant', {
      target_plant_id: targetPlantId,
      replacement_plant_id: replacementPlantId,
    })
    expect(error).not.toBeNull()
    // Target plant still exists.
    const { data } = await admin.from('plants').select('id').eq('id', targetPlantId)
    expect(data?.length).toBe(1)
  })

  test('AC: reassignment rejects a same-plant replacement', async () => {
    const { error } = await adminUser.client.rpc('reassign_and_delete_plant', {
      target_plant_id: targetPlantId,
      replacement_plant_id: targetPlantId,
    })
    expect(error).not.toBeNull()
  })

  test('AC: an admin reassignment re-points plan lines then deletes the plant (no orphan)', async () => {
    const { error } = await adminUser.client.rpc('reassign_and_delete_plant', {
      target_plant_id: targetPlantId,
      replacement_plant_id: replacementPlantId,
    })
    expect(error).toBeNull()

    // The target plant is gone…
    const { data: gone } = await admin.from('plants').select('id').eq('id', targetPlantId)
    expect(gone ?? []).toEqual([])

    // …and the line that pointed at it now points at the replacement — no orphan.
    const { data: lines } = await admin.from('plan_plants').select('plant_id').eq('plan_id', aPlanId)
    expect(lines?.every((l) => l.plant_id === replacementPlantId)).toBe(true)
    expect(lines?.length).toBe(2)
  })
})
