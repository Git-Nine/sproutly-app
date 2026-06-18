import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * PROJ-3 — two-account runtime verification of the scans security ACs (owner-only
 * RLS read/edit/delete + cross-user denial; photo namespace isolation), mirroring
 * the PROJ-2 harness. Seeds two real users via the admin API, acts as each through
 * a real session, asserts isolation end-to-end, then cascade-deletes them.
 *
 * Runs in the browser-less `rls` Playwright project (filename matches its testMatch).
 * Skips cleanly without the Supabase env (incl. service-role key).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ready = Boolean(url && anonKey && serviceKey)

const BUCKET = 'photos'
const EMAIL_PREFIX = 'proj3.scans.'
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type SeededUser = { id: string; client: SupabaseClient }

function newScan(userId: string, scanId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: scanId,
    user_id: userId,
    photo_path: `${userId}/scans/${scanId}/photo`,
    postcode: '10115',
    sun_exposure: 'full',
    surface: 'gravel',
    space_type: 'back_garden',
    area_sqm: 20,
    ...overrides,
  }
}

test.describe('PROJ-3 scans cross-account RLS + storage isolation (two real accounts)', () => {
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
    await purgeTestUsers()
    a = await seed('a')
    b = await seed('b')
  })

  test.afterAll(async () => {
    if (!ready) return
    await purgeTestUsers()
  })

  test('a user can create and read back their own scan', async () => {
    const { error: insErr } = await a.client.from('scans').insert(newScan(a.id, scanA, { name: 'Back garden' }))
    expect(insErr).toBeNull()

    const { data, error } = await a.client.from('scans').select('id, user_id, name').eq('id', scanA).single()
    expect(error).toBeNull()
    expect(data?.user_id).toBe(a.id)
    expect(data?.name).toBe('Back garden')
  })

  test('AC-security: another user cannot see the scan', async () => {
    const { data: all } = await b.client.from('scans').select('id')
    expect(all?.map((r) => r.id)).not.toContain(scanA)
    const { data: direct } = await b.client.from('scans').select('id').eq('id', scanA)
    expect(direct).toEqual([])
  })

  test('AC-security: another user cannot update the scan', async () => {
    await b.client.from('scans').update({ area_sqm: 999, name: 'hacked' }).eq('id', scanA)
    const { data } = await a.client.from('scans').select('area_sqm, name').eq('id', scanA).single()
    expect(data?.area_sqm).toBe(20)
    expect(data?.name).toBe('Back garden')
  })

  test('AC-security: another user cannot delete the scan', async () => {
    await b.client.from('scans').delete().eq('id', scanA)
    const { data } = await a.client.from('scans').select('id').eq('id', scanA)
    expect(data?.map((r) => r.id)).toEqual([scanA])
  })

  test('AC-security: a user cannot create a scan owned by someone else', async () => {
    // RLS INSERT with_check requires user_id = auth.uid().
    const { error } = await a.client.from('scans').insert(newScan(b.id, randomUUID()))
    expect(error).not.toBeNull()
  })

  test('AC-7/8: scan photos are isolated to the owner namespace', async () => {
    const file = new Blob(['scan-probe'], { type: 'text/plain' })
    const ownPath = `${a.id}/scans/${scanA}/photo`
    const crossPath = `${b.id}/scans/${scanA}/photo`

    const { error: ownErr } = await a.client.storage.from(BUCKET).upload(ownPath, file, { upsert: true })
    expect(ownErr).toBeNull()

    const { error: crossWriteErr } = await a.client.storage.from(BUCKET).upload(crossPath, file, { upsert: true })
    expect(crossWriteErr).not.toBeNull()

    const { data: dl, error: crossReadErr } = await b.client.storage.from(BUCKET).download(ownPath)
    expect(dl).toBeNull()
    expect(crossReadErr).not.toBeNull()
  })

  test('a user can update and delete their own scan', async () => {
    const { error: updErr } = await a.client.from('scans').update({ area_sqm: 42 }).eq('id', scanA)
    expect(updErr).toBeNull()
    const { data: upd } = await a.client.from('scans').select('area_sqm').eq('id', scanA).single()
    expect(upd?.area_sqm).toBe(42)

    const { error: delErr } = await a.client.from('scans').delete().eq('id', scanA)
    expect(delErr).toBeNull()
    const { data: gone } = await a.client.from('scans').select('id').eq('id', scanA)
    expect(gone).toEqual([])
  })
})
