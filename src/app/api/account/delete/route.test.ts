import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the two Supabase clients the route depends on.
const getUser = vi.fn()
const deleteUser = vi.fn()
const list = vi.fn()
const remove = vi.fn()
const from = vi.fn(() => ({ list, remove }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { deleteUser } },
    storage: { from },
  })),
}))

import { POST } from './route'

describe('POST /api/account/delete', () => {
  beforeEach(() => {
    getUser.mockReset()
    deleteUser.mockReset()
    list.mockReset()
    remove.mockReset()
    from.mockClear()
    // Default: a flat folder with one avatar file and a `scans` subfolder holding one photo.
    list.mockImplementation(async (prefix: string) => {
      if (prefix === 'user-1') {
        return { data: [{ name: 'avatar', id: 'f1' }, { name: 'scans', id: null }], error: null }
      }
      if (prefix === 'user-1/scans') {
        return { data: [{ name: 's1', id: null }], error: null }
      }
      if (prefix === 'user-1/scans/s1') {
        return { data: [{ name: 'photo', id: 'f2' }], error: null }
      }
      return { data: [], error: null }
    })
    remove.mockResolvedValue({ data: [], error: null })
  })

  it('removes the user’s photos (recursively) then deletes the account (happy path)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    deleteUser.mockResolvedValue({ error: null })

    const res = await POST()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    // Recursed into scans/s1 and collected both the avatar and the scan photo.
    expect(remove).toHaveBeenCalledWith(['user-1/avatar', 'user-1/scans/s1/photo'])
    expect(deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('still deletes the account when storage cleanup fails (best-effort)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    deleteUser.mockResolvedValue({ error: null })
    list.mockRejectedValue(new Error('storage down'))

    const res = await POST()

    expect(res.status).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('skips remove() when the user has no files', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    deleteUser.mockResolvedValue({ error: null })
    list.mockResolvedValue({ data: [], error: null })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(remove).not.toHaveBeenCalled()
  })

  it('returns 401 when there is no session (auth check)', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await POST()

    expect(res.status).toBe(401)
    expect(deleteUser).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('uses the caller session id, never a client-supplied id', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'real-caller' } } })
    deleteUser.mockResolvedValue({ error: null })
    list.mockResolvedValue({ data: [], error: null })

    await POST()

    expect(deleteUser).toHaveBeenCalledWith('real-caller')
  })

  it('returns 500 when the privileged delete fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    deleteUser.mockResolvedValue({ error: { message: 'boom' } })

    const res = await POST()

    expect(res.status).toBe(500)
  })
})
