import { createHash, randomUUID } from 'node:crypto'
import type { Collection } from 'mongodb'
import { ApiError } from './auth'
import { deployEscrowContract, withJobOperation } from './genlayer'
import { getMongoDatabase } from './mongodb'
import { createJob, getJob } from './store'
import { createJobVault } from './vault'
import type { Job } from './types'

export type JobOffer = Pick<Job, 'title' | 'description' | 'budgetZatoshis' | 'budgetZec' | 'category' | 'assignmentMode' | 'deadline'>
type Vault = Awaited<ReturnType<typeof createJobVault>>
type CreationIntent = {
  _id: string; actor: string; payloadHash: string; offer: JobOffer; jobId: string; createdAt: string
  vault?: Vault; deploymentHash?: string; contractAddress?: string; completed?: boolean
}
const durableOptions = { readConcern: { level: 'majority' as const }, writeConcern: { w: 'majority' as const, j: true } }

export function creationKey(bodyKey: unknown, headerKey: string | null): string {
  if (bodyKey !== undefined && typeof bodyKey !== 'string') throw new ApiError(400, 'Invalid job creation identifier')
  if (bodyKey !== undefined && headerKey !== null && bodyKey !== headerKey) throw new ApiError(400, 'Job creation identifiers do not match')
  const key = headerKey ?? bodyKey
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new ApiError(400, 'A stable creationId or Idempotency-Key is required to create a job safely')
  }
  return key
}

async function persist(collection: Collection<CreationIntent>, id: string, patch: Partial<CreationIntent>): Promise<void> {
  try {
    const result = await collection.updateOne({ _id: id }, { $set: patch })
    if (!result.acknowledged || result.matchedCount !== 1) throw new Error('Unacknowledged creation intent')
  } catch { throw new ApiError(503, 'Job creation recovery storage is unavailable. Retry with the same creation identifier.') }
}

async function reserve(collection: Collection<CreationIntent>, id: string, actor: string, offer: JobOffer): Promise<CreationIntent> {
  const payloadHash = createHash('sha256').update(JSON.stringify(offer)).digest('hex')
  const proposed: CreationIntent = { _id: id, actor, payloadHash, offer, jobId: 'job_' + randomUUID(), createdAt: new Date().toISOString() }
  let intent: CreationIntent
  try {
    const result = await collection.insertOne(proposed)
    if (!result.acknowledged) throw new Error('Unacknowledged creation reservation')
    intent = proposed
  } catch {
    // An uncertain insert must be resolved by its stable key before any provider call.
    const existing = await collection.findOne({ _id: id })
    if (!existing) throw new ApiError(503, 'Job creation intent could not be saved. Retry with the same creation identifier.')
    intent = existing
  }
  if (intent.actor !== actor || intent.payloadHash !== payloadHash) throw new ApiError(409, 'This creation identifier already belongs to a different job offer')
  return intent
}

export async function createJobFromIntent(actor: string, key: string, offer: JobOffer): Promise<Job> {
  const db = await getMongoDatabase()
  if (!db) throw new ApiError(503, 'MongoDB is required for durable job creation')
  const id = createHash('sha256').update(JSON.stringify(['job-creation-v1', actor, key])).digest('hex')
  return withJobOperation('creation:' + id, async () => {
    const collection = db.collection<CreationIntent>('job_creation_intents', durableOptions)
    const intent = await reserve(collection, id, actor, offer)
    const existing = await getJob(intent.jobId)
    if (existing) {
      if (existing.clientAddress !== actor || existing.genlayerContractAddress !== intent.contractAddress ||
          existing.vaultReference !== intent.vault?.reference) throw new ApiError(409, 'Stored job creation requires operator reconciliation')
      await persist(collection, id, { completed: true })
      return existing
    }
    let vault = intent.vault
    if (!vault) {
      try { vault = await createJobVault(intent.jobId) }
      catch (error) {
        throw new ApiError(503, 'Testnet vault creation failed: ' + (error instanceof Error ? error.message : 'Wallet unavailable'))
      }
      await persist(collection, id, { vault })
    }
    let genlayerContractAddress = intent.contractAddress
    if (!genlayerContractAddress) {
      try {
        genlayerContractAddress = await deployEscrowContract({ taskTitle: intent.offer.title,
          taskDescription: intent.offer.description, creationScope: id,
          onTransactionHash: (deploymentHash) => persist(collection, id, { deploymentHash }) })
      } catch (error) {
        throw new ApiError(503, 'GenLayer deployment could not complete: ' + (error instanceof Error ? error.message : 'Provider unavailable'))
      }
      await persist(collection, id, { contractAddress: genlayerContractAddress })
    }
    const job: Job = { ...intent.offer, id: intent.jobId, clientAddress: actor, workerAddress: '', status: 'funding_required',
      vaultAddress: vault.address, vaultReference: vault.reference, vaultNetwork: vault.network, fundedAt: null, fundedZatoshis: 0,
      genlayerContractAddress, createdAt: intent.createdAt, updatedAt: intent.createdAt, submissions: [], applications: [] }
    // The complete provider linkage is already durable before inserting the public job.
    try { await createJob(job) }
    catch (error) {
      const recovered = await getJob(intent.jobId)
      if (!recovered) throw error
      if (recovered.clientAddress !== actor || recovered.genlayerContractAddress !== genlayerContractAddress ||
          recovered.vaultReference !== vault.reference) throw new ApiError(409, 'Stored job creation requires operator reconciliation')
      await persist(collection, id, { completed: true })
      return recovered
    }
    await persist(collection, id, { completed: true })
    return job
  })
}
