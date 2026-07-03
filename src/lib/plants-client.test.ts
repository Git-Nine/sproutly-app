import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Plant, PlantValues } from '@/lib/plants'
import { savePlant, deletePlantWithReassign, isUniqueViolation } from './plants-client'

const VALUES: PlantValues = {
  common_name: 'Purpur-Sonnenhut',
  latin_name: 'Echinacea purpurea',
  sun_tolerance: ['full', 'partial'],
  soil_compatibility: ['loam', 'sand'],
  min_hardiness_zone: 5,
  mature_height_cm: 90,
  mature_spread_cm: 45,
  maintenance_level: 'low',
  plant_type: 'perennial',
  native: false,
  image_url: '  ',
  care_notes: '',
}

const EXISTING = { id: 'plant-1' } as Plant

type Client = Parameters<typeof savePlant>[0]

function mockClient() {
  const insert = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => ({ error: null }))
  const updateEq = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => ({ error: null }))
  const update = vi.fn((..._args: unknown[]) => ({ eq: updateEq }))
  const rpc = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => ({ error: null }))
  const client = { from: vi.fn(() => ({ insert, update })), rpc } as unknown as Client
  return { client, insert, update, updateEq, rpc }
}

describe('savePlant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new plant with empty optional fields mapped to null', async () => {
    const { client, insert, update } = mockClient()

    await savePlant(client, { existing: null, values: VALUES })

    expect(update).not.toHaveBeenCalled()
    expect(insert.mock.calls[0][0]).toMatchObject({
      latin_name: 'Echinacea purpurea',
      image_url: null,
      care_notes: null,
    })
  })

  it('updates an existing plant by id', async () => {
    const { client, insert, update, updateEq } = mockClient()

    await savePlant(client, {
      existing: EXISTING,
      values: { ...VALUES, image_url: 'https://img.example/a.jpg' },
    })

    expect(insert).not.toHaveBeenCalled()
    expect(update.mock.calls[0][0]).toMatchObject({ image_url: 'https://img.example/a.jpg' })
    expect(updateEq).toHaveBeenCalledWith('id', EXISTING.id)
  })

  it('throws the supabase error so callers can inspect its code', async () => {
    const { client, insert } = mockClient()
    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })

    await expect(savePlant(client, { existing: null, values: VALUES })).rejects.toMatchObject({
      code: '23505',
    })
  })
})

describe('isUniqueViolation', () => {
  it('recognises the Postgres unique_violation code', () => {
    expect(isUniqueViolation({ code: '23505', message: 'dup' })).toBe(true)
    expect(isUniqueViolation({ code: '42501' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})

describe('deletePlantWithReassign', () => {
  it('calls the atomic reassign_and_delete_plant RPC', async () => {
    const { client, rpc } = mockClient()

    await deletePlantWithReassign(client, {
      targetPlantId: 'plant-1',
      replacementPlantId: 'plant-2',
    })

    expect(rpc).toHaveBeenCalledWith('reassign_and_delete_plant', {
      target_plant_id: 'plant-1',
      replacement_plant_id: 'plant-2',
    })
  })

  it('throws when the RPC reports an error', async () => {
    const { client, rpc } = mockClient()
    rpc.mockResolvedValue({ error: { message: 'not admin' } })

    await expect(
      deletePlantWithReassign(client, { targetPlantId: 'a', replacementPlantId: 'b' }),
    ).rejects.toMatchObject({ message: 'not admin' })
  })
})
