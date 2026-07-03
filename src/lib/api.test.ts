import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const getUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

import { requireUser, parseJson } from './api'

function req(body: unknown, { raw = false }: { raw?: boolean } = {}) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

describe('requireUser', () => {
  beforeEach(() => getUser.mockReset())

  it('returns the user and client when a session exists', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const auth = await requireUser()

    expect(auth.response).toBeNull()
    expect(auth.user).toMatchObject({ id: 'user-1' })
    expect(auth.supabase).toBeDefined()
  })

  it('returns a 401 response when there is no session', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const auth = await requireUser()

    expect(auth.user).toBeNull()
    expect(auth.response?.status).toBe(401)
    await expect(auth.response?.json()).resolves.toEqual({ error: 'Not authenticated.' })
  })
})

describe('parseJson', () => {
  const schema = z.object({ id: z.string().uuid('id must be a valid UUID') })
  const UUID = 'aaaaaaaa-0000-4000-a000-000000000001'

  it('returns the parsed data for a valid body', async () => {
    const result = await parseJson(req({ id: UUID }), schema)

    expect(result.response).toBeNull()
    expect(result.data).toEqual({ id: UUID })
  })

  it('returns a 400 response for a non-JSON body', async () => {
    const result = await parseJson(req('not json', { raw: true }), schema)

    expect(result.data).toBeNull()
    expect(result.response?.status).toBe(400)
    await expect(result.response?.json()).resolves.toEqual({ error: 'Invalid request body.' })
  })

  it('returns a 400 with the first Zod issue message on schema failure', async () => {
    const result = await parseJson(req({ id: 'nope' }), schema)

    expect(result.data).toBeNull()
    expect(result.response?.status).toBe(400)
    await expect(result.response?.json()).resolves.toEqual({ error: 'id must be a valid UUID' })
  })
})
