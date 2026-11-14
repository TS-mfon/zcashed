import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>>, enabled: true }))
const collection = {
  async insertOne(row: Record<string, unknown>) {
    const id = String(row._id)
    if (boundary.rows[id]) throw Object.assign(new Error('Duplicate key'), { code: 11000 })
    boundary.rows = { ...boundary.rows, [id]: { ...row } }
    return { acknowledged: true }
  },
  async findOne(query: Record<string, unknown>) { return boundary.rows[String(query._id)] ?? null },
  find() { return { toArray: async () => Object.values(boundary.rows).filter((row) => row.kind === 'operation') } },
  async updateOne(query: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
    const row = boundary.rows[String(query._id)]
    if (!row || (query.token && row.token !== query.token) || (query.dispatchToken && row.dispatchToken !== query.dispatchToken)) return { acknowledged: true, matchedCount: 0 }
    boundary.rows = { ...boundary.rows, [String(query._id)]: { ...row, ...update.$set } }
    return { acknowledged: true, matchedCount: 1 }
  },
  async findOneAndUpdate(query: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
    const row = boundary.rows[String(query._id)]
    const deadline = query.expiresAt as { $lte: Date }
    if (!row || !(row.expiresAt instanceof Date) || row.expiresAt > deadline.$lte) return null
    const next = { ...row, ...update.$set }
    boundary.rows = { ...boundary.rows, [String(query._id)]: next }
    return next
  },
  async deleteOne(query: Record<string, unknown>) {
    const row = boundary.rows[String(query._id)]
    if (!row || (query.token && row.token !== query.token)) return { acknowledged: true, deletedCount: 0 }
    boundary.rows = Object.fromEntries(Object.entries(boundary.rows).filter(([id]) => id !== query._id))
    return { acknowledged: true, deletedCount: 1 }
  },
}
vi.mock('../lib/mongodb', () => ({ getMongoDatabase: async () => boundary.enabled ? { collection: () => collection } : null }))

beforeEach(() => { boundary.rows = {}; boundary.enabled = true; vi.useRealTimers(); vi.resetModules() })

describe('durable GenLayer dispatch and job leases', () => {
  it('permits one job lease across independent server modules', async () => {
    const first = await import('../lib/genlayer-operations')
    const lease = await first.acquireJobLease('job1')
    vi.resetModules()
    const replica = await import('../lib/genlayer-operations')
    await expect(replica.acquireJobLease('job1')).rejects.toThrow(/in progress/)
    await first.releaseJobLease(lease)
    await expect(replica.acquireJobLease('job1')).resolves.toBeDefined()
  })
  it('reclaims an expired lease and prevents its previous owner from releasing the replacement', async () => {
    vi.useFakeTimers()
    const operations = await import('../lib/genlayer-operations')
    const original = await operations.acquireJobLease('job1', 1000)
    vi.setSystemTime(Date.now() + 1001)
    const replacement = await operations.acquireJobLease('job1', 1000)
    await operations.releaseJobLease(original)
    await expect(operations.acquireJobLease('job1')).rejects.toThrow(/in progress/)
    await operations.releaseJobLease(replacement)
    vi.useRealTimers()
  })
  it('reserves dispatch durably before sending and retains its hash across a restart', async () => {
    const operations = await import('../lib/genlayer-operations')
    const key = 'a'.repeat(64)
    const address = '0x' + '1'.repeat(40)
    const first = await operations.reserveOperation(key, address)
    expect(first.isNew).toBe(true)
    expect(Object.hasOwn(boundary.rows[key], 'hash')).toBe(false)
    expect((await operations.reserveOperation(key, address)).isNew).toBe(false)
    await operations.attachOperationHash(key, first.record.dispatchToken!, '0x' + '2'.repeat(64))
    vi.resetModules()
    const restarted = await import('../lib/genlayer-operations')
    expect((await restarted.readOperationJournal())[key].hash).toBe('0x' + '2'.repeat(64))
    await restarted.patchOperation(key, { pending: false })
    await restarted.patchOperation(key, { settled: true })
    expect((await restarted.readOperationJournal())[key].settled).toBe(true)
  })
  it('retains an unknown dispatch reservation instead of allowing another sender', async () => {
    const operations = await import('../lib/genlayer-operations')
    const key = 'b'.repeat(64)
    await operations.reserveOperation(key, '0x' + '1'.repeat(40))
    vi.resetModules()
    const reserved = await (await import('../lib/genlayer-operations')).reserveOperation(key, '0x' + '1'.repeat(40))
    expect(reserved.isNew).toBe(false)
    expect(reserved.record.hash).toBeUndefined()
  })
})
