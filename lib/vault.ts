import { createHash, randomUUID } from 'node:crypto'
import type { Collection, Db } from 'mongodb'
import { getMongoDatabase } from './mongodb'
import { getJob, updateJob } from './store'
import type { Job } from './types'
import { parseShieldedAddress } from './zcash'
import { deriveVaultAddress, inspectPayout, prepareShieldedPayout, sendShieldedPayout, verifyVaultDeposit, zalletConfiguration, type VaultReceipt } from './zallet'

// Private operational records are deliberately separate from publicly listed jobs.
// These records must never be sent to GenLayer or returned by the jobs API.
type ClaimState = 'reserved' | 'broadcasting' | 'broadcast' | 'unbroadcast' | 'unknown' | 'confirmed'
type ReleasePurpose = 'worker_payout' | 'client_refund'
type Allocation = { _id: string; kind: 'allocation'; jobId: string; accountId: string; diversifierIndex: number;
  reference: string; address?: string; startHeight?: number; createdAt: string }
type Deposit = { _id: string; kind: 'deposit'; jobId: string; accountId: string; address: string; reference: string;
  receiptId: string; receipt: VaultReceipt; confirmedAt: string }
type Claim = { _id: string; kind: 'claim'; jobId: string; accountId: string; claimantId: string; purpose: ReleasePurpose; payoutAddress: string;
  amountZatoshis: number; memo: string; state: ClaimState; txid?: string; broadcast?: boolean; confirmations?: number;
  createdAt: string; updatedAt: string }

export interface PrivateVaultOperation { purpose: ReleasePurpose; state: ClaimState; txid?: string; confirmations: number; message: string }
export class VaultError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
async function database(): Promise<Db> {
  const db = await getMongoDatabase()
  if (!db) throw new VaultError(503, 'MongoDB is required for durable custodial vault reservations.')
  return db
}
const durableOptions = { readConcern: { level: 'majority' as const }, writeConcern: { w: 'majority' as const, j: true } }
function allocations(db: Db): Collection<Allocation> { return db.collection<Allocation>('vault_operations', durableOptions) }
function deposits(db: Db): Collection<Deposit> { return db.collection<Deposit>('vault_operations', durableOptions) }
function claims(db: Db): Collection<Claim> { return db.collection<Claim>('vault_operations', durableOptions) }
function isDuplicate(error: unknown): boolean { return (error as { code?: number })?.code === 11000 }
async function write(operation: () => Promise<{ acknowledged: boolean; matchedCount?: number }>): Promise<void> {
  try {
    const result = await operation()
    if (!result.acknowledged || result.matchedCount === 0) throw new Error('Write was not acknowledged')
  } catch { throw new VaultError(503, 'Private vault operation storage is unavailable; the operator must reconcile any pending claim.') }
}
async function saveClaim(db: Db, operation: Claim): Promise<void> {
  const { _id, ...fields } = operation
  await write(() => claims(db).updateOne({ _id, kind: 'claim' }, { $set: fields }))
}
function publicOperation(operation: Claim): PrivateVaultOperation {
  const noun = operation.purpose === 'client_refund' ? 'refund' : 'payout'
  const title = operation.purpose === 'client_refund' ? 'Refund' : 'Payout'
  const messages: Record<ClaimState, string> = {
    reserved: title + ' reserved. The server will not issue another release while this reservation exists.',
    broadcasting: 'The server wallet is signing and broadcasting the reserved ' + noun + '.',
    broadcast: 'The wallet broadcast the ' + noun + '. Completion awaits a confirmed matching wallet receipt.',
    unbroadcast: 'The wallet built the ' + noun + ' but broadcasting is disabled. The operator must resolve it; the app will not resend.',
    unknown: title + ' outcome is uncertain. The operator must reconcile the wallet; the app will not resend.',
    confirmed: 'The server wallet confirmed the matching shielded ' + noun + '.',
  }
  return { purpose: operation.purpose, state: operation.state, ...(operation.txid ? { txid: operation.txid } : {}),
    confirmations: operation.confirmations ?? 0, message: messages[operation.state] }
}
async function allocationFor(db: Db, job: Job): Promise<Allocation> {
  const allocation = await allocations(db).findOne({ _id: 'allocation:' + job.id, kind: 'allocation' })
  if (!allocation || allocation.accountId !== zalletConfiguration().accountId || !allocation.startHeight ||
      allocation.address !== job.vaultAddress || allocation.reference !== job.vaultReference || job.vaultNetwork !== 'testnet') {
    throw new VaultError(409, 'The stored job does not match a configured testnet vault allocation.')
  }
  return allocation
}

export async function createJobVault(jobId: string): Promise<{ address: string; reference: string; network: 'testnet' }> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)) throw new VaultError(400, 'Invalid vault job identifier.')
  const db = await database()
  const accountId = zalletConfiguration().accountId
  // The unique indexes guard both diversifier collisions and receipt reuse across jobs.
  await allocations(db).createIndex({ accountId: 1, diversifierIndex: 1 }, { unique: true, partialFilterExpression: { kind: 'allocation' } })
  await deposits(db).createIndex({ receiptId: 1 }, { unique: true, partialFilterExpression: { kind: 'deposit' } })
  let allocation = await allocations(db).findOne({ _id: 'allocation:' + jobId, kind: 'allocation' })
  if (!allocation) {
    const nonce = randomUUID()
    const diversifierIndex = createHash('sha256').update('zcashed-vault-v1:' + accountId + ':' + jobId + ':' + nonce).digest().readUIntBE(0, 6) || 1
    const intent: Allocation = { _id: 'allocation:' + jobId, kind: 'allocation', jobId, accountId, diversifierIndex,
      reference: 'zcashed:v1:deposit:' + nonce, createdAt: new Date().toISOString() }
    try { await write(() => allocations(db).insertOne(intent)); allocation = intent }
    catch (error) {
      // Resolve a duplicate or uncertain insert by reading the durable existing allocation.
      const existing = await allocations(db).findOne({ _id: intent._id, kind: 'allocation' })
      if (!existing) throw error
      allocation = existing
    }
  }
  if (allocation.accountId !== accountId) throw new VaultError(409, 'The vault account configuration changed; the operator must reconcile it.')
  const derived = await deriveVaultAddress(allocation.diversifierIndex)
  if (allocation.address && allocation.address !== derived.address) throw new VaultError(409, 'The wallet derived a different address for the reserved vault.')
  await write(() => allocations(db).updateOne({ _id: allocation!._id, kind: 'allocation' }, { $set: {
    address: derived.address, startHeight: allocation!.startHeight ?? derived.startHeight,
  } }))
  return { address: derived.address, reference: allocation.reference, network: 'testnet' }
}

export async function confirmJobFunding(job: Job): Promise<{ job: Job; received: boolean }> {
  const db = await database()
  const allocation = await allocationFor(db, job)
  if (job.status !== 'funding_required' && job.status !== 'cancelled' && job.status !== 'rejected') {
    if (job.fundedAt && job.fundedZatoshis >= job.budgetZatoshis) return { job, received: true }
    throw new VaultError(409, 'This job is not awaiting a vault deposit.')
  }
  const receipt = await verifyVaultDeposit({ address: job.vaultAddress, reference: job.vaultReference,
    amountZatoshis: job.budgetZatoshis, startHeight: allocation.startHeight! })
  if (!receipt) return { job, received: false }
  const deposit: Deposit = { _id: 'deposit:' + job.id, kind: 'deposit', jobId: job.id, accountId: allocation.accountId,
    address: job.vaultAddress, reference: job.vaultReference, receiptId: receipt.txid + ':' + receipt.outputIndex,
    receipt, confirmedAt: new Date().toISOString() }
  try {
    const result = await deposits(db).insertOne(deposit)
    if (!result.acknowledged) throw new Error('Deposit was not acknowledged')
  } catch (error) {
    if (!isDuplicate(error)) throw new VaultError(503, 'The verified deposit could not be stored durably.')
    const existing = await deposits(db).findOne({ _id: deposit._id, kind: 'deposit' })
    if (!existing || existing.receiptId !== deposit.receiptId || existing.reference !== deposit.reference) {
      throw new VaultError(409, 'This wallet receipt is already reserved or does not match the job.')
    }
  }
  const updated = await updateJob(job.id, { status: job.status === 'funding_required' ? 'open' : job.status,
    fundedAt: deposit.confirmedAt, fundedZatoshis: receipt.amountZatoshis }, { status: job.status, clientAddress: job.clientAddress })
  if (!updated) throw new VaultError(409, 'Job funding changed concurrently; refresh its current state.')
  return { job: updated, received: true }
}

export async function getPrivateVaultOperation(jobId: string): Promise<PrivateVaultOperation | null> {
  const operation = await claims(await database()).findOne({ _id: 'claim:' + jobId, kind: 'claim' })
  return operation ? publicOperation(operation) : null
}

async function reconcile(db: Db, job: Job, operation: Claim): Promise<{ job: Job; operation: PrivateVaultOperation }> {
  const refund = operation.purpose === 'client_refund'
  const claimant = refund ? job.clientAddress : job.workerAddress
  const pendingStatus = refund ? 'refunding' : 'claiming'
  const finalStatus = refund ? 'refunded' : 'completed'
  if (operation.claimantId !== claimant || operation.amountZatoshis !== job.budgetZatoshis) throw new VaultError(409, 'The claim reservation does not match this job.')
  if (operation.txid) {
    const evidence = await inspectPayout({ txid: operation.txid, address: operation.payoutAddress,
      amountZatoshis: operation.amountZatoshis, memo: operation.memo })
    const next: Claim = { ...operation, state: evidence.confirmed ? 'confirmed' : operation.state === 'confirmed' ? 'broadcast' : operation.state,
      ...(evidence.confirmed ? { broadcast: true } : {}),
      confirmations: evidence.confirmations, updatedAt: new Date().toISOString() }
    await saveClaim(db, next)
    if (evidence.confirmed && job.status === pendingStatus) {
      const completed = await updateJob(job.id, { status: finalStatus }, { status: pendingStatus, workerAddress: job.workerAddress, clientAddress: job.clientAddress })
      if (!completed) throw new VaultError(409, 'Claim completion changed concurrently; refresh the job.')
      return { job: completed, operation: publicOperation(next) }
    }
    if (!evidence.confirmed && job.status === finalStatus) {
      const pending = await updateJob(job.id, { status: pendingStatus }, { status: finalStatus, workerAddress: job.workerAddress, clientAddress: job.clientAddress })
      if (!pending) throw new VaultError(409, 'Payout confirmation changed concurrently; refresh the job.')
      return { job: pending, operation: publicOperation(next) }
    }
    return { job, operation: publicOperation(next) }
  }
  return { job, operation: publicOperation(operation) }
}

export async function claimJobPayment(job: Job, payoutAddress?: string): Promise<{ job: Job; operation: PrivateVaultOperation | null }> {
  return releaseJobFunds(job, payoutAddress, 'worker_payout')
}

export async function refundJobPayment(job: Job, refundAddress?: string): Promise<{ job: Job; operation: PrivateVaultOperation | null }> {
  return releaseJobFunds(job, refundAddress, 'client_refund')
}

function releaseEligibility(job: Job, purpose: ReleasePurpose): void {
  if (!job.fundedAt || job.fundedZatoshis < job.budgetZatoshis) throw new VaultError(409, 'A confirmed full vault deposit is required before releasing funds.')
  if (purpose === 'client_refund') {
    if (job.status !== 'rejected' && job.status !== 'cancelled') throw new VaultError(409, 'A client refund is available only after rejection or cancellation, before any worker payout reservation.')
    return
  }
  if (job.status !== 'approved' || !job.workerAddress) throw new VaultError(409, 'Only the chosen worker’s approved work can be claimed.')
  const approved = job.submissions.at(-1)
  if (!approved || approved.status !== 'approved' || approved.workerAddress !== job.workerAddress || approved.attempt > 3 || job.submissions.length > 3) {
    throw new VaultError(409, 'A finalized approved review within the three-attempt limit is required.')
  }
}

async function releaseFunding(db: Db, job: Job): Promise<Allocation> {
  const allocation = await allocationFor(db, job)
  const deposit = await deposits(db).findOne({ _id: 'deposit:' + job.id, kind: 'deposit' })
  if (!deposit || deposit.accountId !== allocation.accountId || deposit.address !== job.vaultAddress ||
      deposit.reference !== job.vaultReference || deposit.receipt.amountZatoshis < job.budgetZatoshis) {
    throw new VaultError(409, 'The private ledger has no verified full deposit for this job.')
  }
  const currentReceipt = await verifyVaultDeposit({ address: job.vaultAddress, reference: job.vaultReference,
    amountZatoshis: job.budgetZatoshis, startHeight: allocation.startHeight! })
  if (!currentReceipt || currentReceipt.txid !== deposit.receipt.txid || currentReceipt.outputIndex !== deposit.receipt.outputIndex) {
    throw new VaultError(409, 'The wallet no longer confirms the reserved funding receipt.')
  }
  return allocation
}

async function releaseJobFunds(job: Job, payoutAddress: string | undefined, purpose: ReleasePurpose): Promise<{ job: Job; operation: PrivateVaultOperation | null }> {
  const db = await database()
  const existing = await claims(db).findOne({ _id: 'claim:' + job.id, kind: 'claim' })
  if (existing) {
    if (existing.purpose !== purpose) throw new VaultError(409, 'A different release is already reserved for this job. It cannot be paid and refunded twice.')
    return reconcile(db, (await getJob(job.id)) ?? job, existing)
  }
  releaseEligibility(job, purpose)
  if (typeof payoutAddress !== 'string') throw new VaultError(400, 'Enter your Orchard-only testnet payout address.')
  let recipient: string
  try {
    const parsed = parseShieldedAddress(payoutAddress, 'testnet')
    if (parsed.pools.length !== 1 || parsed.preferredPool !== 'orchard') throw new Error('Orchard-only address required')
    recipient = parsed.address
  }
  catch { throw new VaultError(400, 'Use a valid Orchard-only testnet Unified Address copied from your existing wallet.') }
  const allocation = await releaseFunding(db, job)
  recipient = await prepareShieldedPayout(recipient, job.budgetZatoshis)
  const now = new Date().toISOString()
  const intent: Claim = { _id: 'claim:' + job.id, kind: 'claim', jobId: job.id, accountId: allocation.accountId,
    claimantId: purpose === 'client_refund' ? job.clientAddress : job.workerAddress, purpose, payoutAddress: recipient, amountZatoshis: job.budgetZatoshis,
    memo: 'zcashed:v1:payout:' + randomUUID(), state: 'reserved', createdAt: now, updatedAt: now }
  try {
    const result = await claims(db).insertOne(intent)
    if (!result.acknowledged) throw new Error('Claim was not acknowledged')
  } catch (error) {
    if (!isDuplicate(error)) throw new VaultError(503, 'The payout intent could not be reserved durably. No payout was requested.')
    const reservation = await claims(db).findOne({ _id: intent._id, kind: 'claim' })
    if (!reservation) throw new VaultError(409, 'The claim reservation changed; refresh the job.')
    if (reservation.purpose !== purpose) throw new VaultError(409, 'A different release is already reserved for this job.')
    return reconcile(db, (await getJob(job.id)) ?? job, reservation)
  }
  const claiming = await updateJob(job.id, { status: purpose === 'client_refund' ? 'refunding' : 'claiming' },
    { status: job.status, workerAddress: job.workerAddress, clientAddress: job.clientAddress })
  if (!claiming) {
    await write(() => claims(db).updateOne({ _id: intent._id }, { $set: { state: 'unknown', updatedAt: new Date().toISOString() } }))
    throw new VaultError(409, 'The job changed while reserving its claim. The operator must reconcile the reservation.')
  }
  return broadcastRelease(db, claiming, intent)
}

async function broadcastRelease(db: Db, claiming: Job, intent: Claim): Promise<{ job: Job; operation: PrivateVaultOperation }> {
  await write(() => claims(db).updateOne({ _id: intent._id, state: 'reserved' }, { $set: { state: 'broadcasting', updatedAt: new Date().toISOString() } }))
  let outcome: { txid: string; broadcast: boolean } | undefined
  try {
    outcome = await sendShieldedPayout({ address: intent.payoutAddress, amountZatoshis: intent.amountZatoshis, memo: intent.memo })
    const sent: Claim = { ...intent, ...outcome, state: outcome.broadcast ? 'broadcast' : 'unbroadcast', updatedAt: new Date().toISOString() }
    await saveClaim(db, sent)
    return { job: claiming, operation: publicOperation(sent) }
  } catch {
    const unknown: Claim = { ...intent, ...outcome, state: 'unknown', updatedAt: new Date().toISOString() }
    await saveClaim(db, unknown)
    return { job: claiming, operation: publicOperation(unknown) }
  }
}
