import { describe, it, expect, vi, beforeEach } from 'vitest'
import { replacePlanLines, type PlanLineInput } from './plans-client'

const PLAN_ID = 'aaaaaaaa-0000-4000-a000-000000000001'

const LINES: PlanLineInput[] = [
  { plantId: 'plant-1', quantity: 3, soilFlag: false, pinned: true },
  { plantId: 'plant-2', quantity: 8, soilFlag: true, pinned: false },
]

type Client = Parameters<typeof replacePlanLines>[0]

function mockClient() {
  const calls: string[] = []
  const insert = vi.fn(async (..._args: unknown[]): Promise<{ error: unknown }> => {
    calls.push('insert')
    return { error: null }
  })
  const deleteNot = vi.fn(async (..._args: unknown[]) => {
    calls.push('delete')
    return { error: null }
  })
  // .delete().eq(...) is awaited directly for the empty case and chained with
  // .not(...) for the prune — the object is both thenable and chainable.
  const eqResult = {
    not: deleteNot,
    then: (resolve: (v: { error: null }) => void) => {
      calls.push('delete')
      resolve({ error: null })
    },
  }
  const deleteEq = vi.fn(() => eqResult)
  const del = vi.fn(() => ({ eq: deleteEq }))
  const client = { from: vi.fn(() => ({ insert, delete: del })) } as unknown as Client
  return { client, calls, insert, del, deleteEq, deleteNot }
}

describe('replacePlanLines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('INSERTS the new rows before pruning the old ones (a failure can never empty the plan)', async () => {
    const { client, calls, insert, deleteNot } = mockClient()

    await replacePlanLines(client, PLAN_ID, LINES)

    expect(calls).toEqual(['insert', 'delete'])

    // Rows carry client-side ids and array-index sort order.
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      plan_id: PLAN_ID,
      plant_id: 'plant-1',
      quantity: 3,
      sort_order: 0,
      soil_flag: false,
      pinned: true,
    })
    expect(rows[1]).toMatchObject({ plant_id: 'plant-2', sort_order: 1 })
    expect(typeof rows[0].id).toBe('string')

    // The prune excludes exactly the freshly inserted ids.
    const [column, op, list] = deleteNot.mock.calls[0] as [string, string, string]
    expect(column).toBe('id')
    expect(op).toBe('in')
    expect(list).toBe(`(${rows.map((r) => r.id).join(',')})`)
  })

  it('does not prune anything when the insert fails (old lines survive)', async () => {
    const { client, insert, deleteNot } = mockClient()
    insert.mockResolvedValue({ error: { message: 'insert failed' } })

    await expect(replacePlanLines(client, PLAN_ID, LINES)).rejects.toMatchObject({
      message: 'insert failed',
    })
    expect(deleteNot).not.toHaveBeenCalled()
  })

  it('deletes all lines when the new set is empty (explicit removal of every plant)', async () => {
    const { client, calls, insert, deleteEq } = mockClient()

    await replacePlanLines(client, PLAN_ID, [])

    expect(insert).not.toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('plan_id', PLAN_ID)
    expect(calls).toEqual(['delete'])
  })
})
