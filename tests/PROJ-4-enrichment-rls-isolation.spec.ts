import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * PROJ-4 — two-account runtime verification of the scan_enrichment security ACs
 * (owner-only RLS, cross-user denial, cascade delete on scan).
 *
 * Mirrors the PROJ-3 RLS harness pattern exactly. Seeds two real users via the
 * admin API, acts as each through a real session, asserts isolation, then purges.
 *
 * Runs in the browser-less `rls` Playwright project (filename matches testMatch).
 * Skips if env vars are missing or if the scan_enrichment table hasn't been
 * created yet (migration pending).
 *
 * Pre-condition: supabase/migrations/20260619100000_proj4_scan_enrichment.sql
 * must be applied before these tests can pass.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ready = Boolean(url && anonKey && serviceKey)

const EMAIL_PREFIX = 'proj4.enrichment.'
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type SeededUser = { id: string; client: SupabaseClient }

function newScan(userId: string, scanId: string) {
  return {
    id: scanId,
    user_id: userId,
    photo_path: `${userId}/scans/${scanId}/photo`,
    postcode: '10115',
    sun_exposure: 'full',
    surface: 'gravel',
    space_type: 'back_garden',
    area_sqm: 20,
  }
}

function newEnrichment(scanId: string, userId: string) {
  return {
    scan_id: scanId,
    user_id: userId,
    status: 'complete',
    requested_at: new Date().toISOString(),
    soil_type: 'loam',
    soil_status: 'success',
    rainfall_mm: 580,
    jan_mean_min_temp: -1.1,
    frost_days: 45,
    climate_status: 'success',
    climate_period: '1991–2020',
    hardiness_zone: '7',
    zone_status: 'success',
    location_basis: 'postcode_centroid',
  }
}

test.describe('PROJ-4 scan_enrichment cross-account RLS (two real accounts)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!ready, 'Set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local to run')

  let admin: SupabaseClient
  let a: SeededUser
  let b: SeededUser
  const scanA = randomUUID()

  async function purgeTestUsers() {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
    const stale = (data?.users ?? []).filter((u) => u.email?.startsWith(EMAIL_PREFIX))
    for (const u of stale) await admin.auth.admin.deleteUser(u.id)
  }

  async function seed(label: string): Promise<SeededUser> {
    const email = `${EMAIL_PREFIX}${stamp}.${label}@example.com`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createErr || !created.user) throw createErr ?? new Error('createUser returned no user')
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (linkErr) throw linkErr
    const otp = link.properties?.email_otp
    if (!otp) throw new Error('generateLink returned no email_otp')
    const client = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: verified, error: otpErr } = await client.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    })
    if (otpErr || !verified.session) throw otpErr ?? new Error('verifyOtp returned no session')
    return { id: created.user.id, client }
  }

  test.beforeAll(async () => {
    if (!ready) return
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Gate the entire suite on the migration being applied.
    // PGRST205 = table not found in schema cache (table doesn't exist).
    const { error: tableErr } = await admin.from('scan_enrichment').select('id').limit(1)
    if (tableErr?.code === 'PGRST205' || tableErr?.code === '42P01') {
      test.skip(true, 'Migration 20260619100000_proj4_scan_enrichment.sql not applied — run it in the Supabase dashboard SQL editor first')
      return
    }

    await purgeTestUsers()
    a = await seed('a')
    b = await seed('b')

    // Seed user A's scan (required before inserting enrichment with FK).
    await admin.from('scans').insert(newScan(a.id, scanA))
  })

  test.afterAll(async () => {
    if (!ready) return
    await purgeTestUsers()
  })

  test('AC-S1: user A can insert and read back their own enrichment', async () => {
    // Use admin client to insert (bypasses RLS, simulating the after() background write).
    const { error: insErr } = await admin.from('scan_enrichment').insert(newEnrichment(scanA, a.id))
    expect(insErr).toBeNull()

    // User A can read it back via their own session (RLS select policy).
    const { data, error } = await a.client
      .from('scan_enrichment')
      .select('scan_id, user_id, status, soil_type')
      .eq('scan_id', scanA)
      .single()
    expect(error).toBeNull()
    expect(data?.user_id).toBe(a.id)
    expect(data?.status).toBe('complete')
    expect(data?.soil_type).toBe('loam')
  })

  test('AC-S1: user B cannot see user A\'s enrichment row', async () => {
    const { data: all } = await b.client.from('scan_enrichment').select('scan_id')
    expect(all?.map((r) => r.scan_id)).not.toContain(scanA)

    const { data: direct } = await b.client
      .from('scan_enrichment')
      .select('scan_id')
      .eq('scan_id', scanA)
    expect(direct).toEqual([])
  })

  test('AC-S1: user B cannot update user A\'s enrichment row', async () => {
    await b.client
      .from('scan_enrichment')
      .update({ soil_type: 'clay', status: 'partial' })
      .eq('scan_id', scanA)

    // Verify A's row is unchanged.
    const { data } = await admin
      .from('scan_enrichment')
      .select('soil_type, status')
      .eq('scan_id', scanA)
      .single()
    expect(data?.soil_type).toBe('loam')
    expect(data?.status).toBe('complete')
  })

  test('AC-S1: user B cannot delete user A\'s enrichment row', async () => {
    await b.client.from('scan_enrichment').delete().eq('scan_id', scanA)

    const { data } = await admin
      .from('scan_enrichment')
      .select('scan_id')
      .eq('scan_id', scanA)
    expect(data?.map((r) => r.scan_id)).toContain(scanA)
  })

  test('AC-S1: user A cannot create an enrichment row owned by user B', async () => {
    const fakeScanForB = randomUUID()
    const { error } = await a.client.from('scan_enrichment').insert({
      ...newEnrichment(fakeScanForB, b.id),
      scan_id: fakeScanForB,
    })
    // RLS INSERT with_check: auth.uid() = user_id — must fail.
    expect(error).not.toBeNull()
  })

  test('cascade delete: enrichment row deleted when its scan is deleted', async () => {
    // Delete the scan — should cascade to scan_enrichment.
    const { error: delErr } = await admin.from('scans').delete().eq('id', scanA)
    expect(delErr).toBeNull()

    const { data } = await admin
      .from('scan_enrichment')
      .select('scan_id')
      .eq('scan_id', scanA)
    expect(data).toEqual([])
  })
})
