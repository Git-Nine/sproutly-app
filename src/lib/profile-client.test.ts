import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProfileValues } from '@/lib/profile'
import { avatarPath, removeAvatar, updateProfile, uploadAvatar } from './profile-client'

const USER_ID = 'user-abc'

type Client = Parameters<typeof updateProfile>[0]

function mockClient() {
  const calls: string[] = []
  const updateEq = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => {
    calls.push('db')
    return { error: null }
  })
  const update = vi.fn((..._args: unknown[]) => ({ eq: updateEq }))
  const upload = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => {
    calls.push('upload')
    return { error: null }
  })
  const remove = vi.fn(async (..._args: unknown[]) => {
    calls.push('storage-remove')
    return { error: null }
  })
  const createSignedUrl = vi.fn(async (..._args: unknown[]) => ({
    data: { signedUrl: 'https://signed.example/avatar?token=x' },
    error: null,
  }))
  const client = {
    from: vi.fn(() => ({ update })),
    storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl })) },
  } as unknown as Client
  return { client, calls, update, updateEq, upload, remove, createSignedUrl }
}

describe('updateProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves trimmed fields and never touches avatar_path', async () => {
    const { client, update, updateEq } = mockClient()
    const values: ProfileValues = {
      display_name: '  Janine ',
      maintenance_preference: 'low',
      experience_level: null,
    }

    await updateProfile(client, USER_ID, values)

    const written = update.mock.calls[0][0] as Record<string, unknown>
    expect(written).toEqual({
      display_name: 'Janine',
      maintenance_preference: 'low',
      experience_level: null,
    })
    expect('avatar_path' in written).toBe(false)
    expect(updateEq).toHaveBeenCalledWith('id', USER_ID)
  })

  it('maps an empty display name to null', async () => {
    const { client, update } = mockClient()

    await updateProfile(client, USER_ID, {
      display_name: '   ',
      maintenance_preference: null,
      experience_level: null,
    })

    expect((update.mock.calls[0][0] as Record<string, unknown>).display_name).toBeNull()
  })
})

describe('uploadAvatar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uploads first, then persists the path, then returns a signed URL', async () => {
    const { client, calls, upload, update } = mockClient()
    const file = new File(['x'], 'me.png', { type: 'image/png' })

    const { signedUrl } = await uploadAvatar(client, USER_ID, file)

    expect(calls).toEqual(['upload', 'db'])
    expect(upload).toHaveBeenCalledWith(avatarPath(USER_ID), file, {
      upsert: true,
      contentType: 'image/png',
    })
    expect(update.mock.calls[0][0]).toEqual({ avatar_path: avatarPath(USER_ID) })
    expect(signedUrl).toContain('https://signed.example/')
  })

  it('does not persist the path when the upload fails', async () => {
    const { client, upload, update } = mockClient()
    upload.mockResolvedValue({ error: { message: 'quota' } })
    const file = new File(['x'], 'me.png', { type: 'image/png' })

    await expect(uploadAvatar(client, USER_ID, file)).rejects.toMatchObject({ message: 'quota' })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('removeAvatar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clears the row FIRST, then drops the file', async () => {
    const { client, calls, update, remove } = mockClient()

    await removeAvatar(client, USER_ID)

    expect(calls).toEqual(['db', 'storage-remove'])
    expect(update.mock.calls[0][0]).toEqual({ avatar_path: null })
    expect(remove).toHaveBeenCalledWith([avatarPath(USER_ID)])
  })

  it('does not drop the file when clearing the row fails', async () => {
    const { client, updateEq, remove } = mockClient()
    updateEq.mockResolvedValue({ error: { message: 'rls' } })

    await expect(removeAvatar(client, USER_ID)).rejects.toMatchObject({ message: 'rls' })
    expect(remove).not.toHaveBeenCalled()
  })
})
